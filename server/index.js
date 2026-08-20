import express from 'express'
import cors from 'cors'
import axios from 'axios'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import AdmZip from 'adm-zip'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from 'dotenv'

const dotenvResult = config({ path: '../.env' })
console.log('dotenv path:', new URL('../.env', import.meta.url).pathname)
if (dotenvResult.error) console.warn('dotenv error:', dotenvResult.error.message)

const app = express()
app.use(cors())

const API_URLS = {
  vline: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline/vehicle-positions',
  metro: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/vehicle-positions',
  tram: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram/vehicle-positions',
}

const TRIP_UPDATE_URLS = {
  vline: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline/trip-updates',
  metro: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/trip-updates',
  tram: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram/trip-updates',
}

const SERVICE_ALERT_URLS = {
  vline: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline/service-alerts',
  metro: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/service-alerts',
  tram: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram/service-alerts',
}

const STOP_MODES = {
  vline: 'REGIONAL TRAIN',
  metro: 'METRO TRAIN',
  tram: 'METRO TRAM',
}

const VALID_NETWORKS = ['vline', 'metro', 'tram']
function resolveNetwork(q) {
  return VALID_NETWORKS.includes(q) ? q : 'vline'
}

const __dirname = dirname(fileURLToPath(import.meta.url))

let stopsCache = null
function getAllStops() {
  if (stopsCache) return stopsCache
  const raw = JSON.parse(readFileSync(join(__dirname, 'public_transport_stops.geojson'), 'utf8'))
  stopsCache = raw.features.map(f => ({
    id: f.properties.STOP_ID,
    name: f.properties.STOP_NAME,
    mode: f.properties.MODE,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }))
  console.log(`Loaded ${stopsCache.length} total stops from GeoJSON`)
  return stopsCache
}

// ── GTFS static schedule ──────────────────────────────────────────────────────

const GTFS_INNER_ZIPS = { vline: '1/google_transit.zip', metro: '2/google_transit.zip', tram: '3/google_transit.zip' }
const gtfsStatic = {}

// Vic's static GTFS bundle is republished weekly with only a rolling 30-day validity window,
// so the local copy needs refreshing periodically or realtime trip IDs stop matching it.
const GTFS_DOWNLOAD_URL = 'https://opendata.transport.vic.gov.au/dataset/3f4e292e-7f8a-4ffe-831f-1953be0fe448/resource/fb152201-859f-4882-9206-b768060b50ad/download/gtfs.zip'
const GTFS_ZIP_PATH = join(__dirname, 'gtfs.zip')
const GTFS_ETAG_PATH = join(__dirname, 'gtfs.zip.etag')
const GTFS_REFRESH_INTERVAL_MS = 24 * 3600 * 1000

function gtfsNetworkZipPath(network) {
  return join(__dirname, `gtfs-${network}.zip`)
}

// The combined bundle is ~280MB (all three networks concatenated) but any one network's actual
// data is only 25-50MB of that — loading the whole thing into memory just to reach one network's
// slice was the cause of an OOM in production. Splitting it into per-network files once here means
// loadGtfsStatic() below only ever has to read the small file it actually needs.
function splitGtfsZip(combinedZipBuffer) {
  const zip = new AdmZip(combinedZipBuffer)
  for (const [network, entryName] of Object.entries(GTFS_INNER_ZIPS)) {
    const entry = zip.getEntry(entryName)
    if (!entry) continue
    writeFileSync(gtfsNetworkZipPath(network), entry.getData())
  }
}

async function refreshGtfsZip() {
  // An etag is only meaningful if we actually have the zip it refers to — otherwise a stale
  // etag (e.g. committed to git while gtfs.zip itself is gitignored) would make a fresh
  // checkout trust a 304 response and end up with no zip file to parse at all.
  let previousEtag = null
  if (existsSync(GTFS_ZIP_PATH)) {
    try { previousEtag = readFileSync(GTFS_ETAG_PATH, 'utf8').trim() } catch {}
  }

  try {
    const response = await axios.get(GTFS_DOWNLOAD_URL, {
      headers: previousEtag ? { 'If-None-Match': previousEtag } : {},
      responseType: 'arraybuffer',
      validateStatus: s => s === 200 || s === 304,
    })

    if (response.status === 304) {
      console.log('GTFS static bundle unchanged upstream, keeping local copy')
      if (Object.keys(GTFS_INNER_ZIPS).some(network => !existsSync(gtfsNetworkZipPath(network)))) {
        console.log('Per-network GTFS zips missing, splitting existing combined bundle')
        splitGtfsZip(readFileSync(GTFS_ZIP_PATH))
      }
      return
    }

    const tmpPath = `${GTFS_ZIP_PATH}.tmp`
    writeFileSync(tmpPath, response.data)
    renameSync(tmpPath, GTFS_ZIP_PATH)
    const etag = response.headers.etag
    if (etag) writeFileSync(GTFS_ETAG_PATH, etag)

    splitGtfsZip(response.data)

    for (const k of Object.keys(gtfsStatic)) delete gtfsStatic[k]
    console.log(`GTFS static bundle refreshed (${(response.data.byteLength / 1e6).toFixed(1)} MB) — caches cleared, will reload lazily`)
  } catch (err) {
    console.error('GTFS bundle refresh failed, keeping existing local copy:', err.message)
  }
}

function splitCsvRow(line) {
  const result = []
  let start = 0, inQuote = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote
    } else if (line[i] === ',' && !inQuote) {
      result.push(line.slice(start, i).replace(/^"|"$/g, ''))
      start = i + 1
    }
  }
  result.push(line.slice(start).replace(/^"|"$/g, '').trimEnd())
  return result
}

function parseGtfsCsv(text) {
  const lines = text.split('\n')
  const headers = splitCsvRow(lines[0].replace(/^﻿/, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line === '\r') continue
    const vals = splitCsvRow(line)
    if (vals.length < 2) continue
    const obj = {}
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = vals[j] ?? ''
    rows.push(obj)
  }
  return rows
}

function gtfsTimeToSecs(t) {
  if (!t) return null
  const parts = t.trim().split(':')
  if (parts.length !== 3) return null
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}

async function loadGtfsStatic(network) {
  if (gtfsStatic[network]) return
  // Keep at most one network's static schedule resident at a time. Only one network's map is
  // ever visible in the UI, but the service-alerts endpoint triggers a load for whatever network
  // is currently selected — without this, a user (or a poller) cycling through all three tabs
  // would leave all three multi-hundred-MB datasets cached simultaneously, which is what took
  // this process well past a memory-capped host's limit. Forcing a collection here, before
  // starting the next network's own multi-hundred-MB parsing burst, matters just as much as the
  // eviction itself — otherwise the outgoing network's memory is only *unreferenced*, not yet
  // reclaimed, and the two peaks stack instead of one replacing the other.
  if (Object.keys(gtfsStatic).length) {
    for (const other of Object.keys(gtfsStatic)) delete gtfsStatic[other]
    if (global.gc) global.gc()
  }

  console.log(`Loading GTFS static for ${network}...`)
  const t0 = Date.now()

  const networkZipPath = gtfsNetworkZipPath(network)
  if (!existsSync(networkZipPath)) {
    // First boot before any refresh has run, or an old checkout with only the combined zip.
    if (!existsSync(GTFS_ZIP_PATH)) throw new Error('No GTFS bundle available yet')
    splitGtfsZip(readFileSync(GTFS_ZIP_PATH))
  }
  const inner = new AdmZip(networkZipPath)

  // stop_times → schedule map. Same lean buffer-scan approach as shapes.txt below — this file
  // can be 150k+ rows, and the generic per-row-object CSV parser was allocating one full object
  // (with every column as a string field) per row just to immediately convert it to 4 numbers.
  const stEntry = inner.getEntry('stop_times.txt')
  if (!stEntry) throw new Error('stop_times.txt not found')
  const schedule = {}
  let stopTimeCount = 0
  {
    const buf = stEntry.getData()
    const firstNewline = buf.indexOf(10)
    const header = splitCsvRow(buf.toString('utf8', 0, firstNewline).replace(/^﻿/, ''))
    const tripIdx = header.indexOf('trip_id')
    const stopIdx = header.indexOf('stop_id')
    const seqIdx = header.indexOf('stop_sequence')
    const arrIdx = header.indexOf('arrival_time')
    const deptIdx = header.indexOf('departure_time')
    const len = buf.length
    let lineStart = firstNewline + 1
    while (lineStart < len) {
      let lineEnd = buf.indexOf(10, lineStart)
      if (lineEnd === -1) lineEnd = len
      let end = lineEnd
      if (end > lineStart && buf[end - 1] === 13) end--
      if (end > lineStart) {
        // Every field in this feed is quoted ("01-ABY-...","07:07:00",...) — a naive split(',')
        // leaves the quote characters in place and silently breaks every downstream key lookup.
        const vals = splitCsvRow(buf.toString('utf8', lineStart, end))
        const tripId = vals[tripIdx]
        if (tripId) {
          if (!schedule[tripId]) schedule[tripId] = []
          schedule[tripId].push({
            stopId: vals[stopIdx],
            seq: parseInt(vals[seqIdx]) || 0,
            arrSecs: gtfsTimeToSecs(vals[arrIdx]),
            deptSecs: gtfsTimeToSecs(vals[deptIdx]),
          })
          stopTimeCount++
        }
      }
      lineStart = lineEnd + 1
    }
  }
  for (const tid of Object.keys(schedule)) schedule[tid].sort((a, b) => a.seq - b.seq)

  // trips → { headsign, shapeId, routeId, serviceId }
  const tripInfo = {}
  const tripsEntry = inner.getEntry('trips.txt')
  if (tripsEntry) {
    for (const r of parseGtfsCsv(tripsEntry.getData().toString('utf8'))) {
      if (r.trip_id) tripInfo[r.trip_id] = {
        headsign: r.trip_headsign ?? '',
        shapeId: r.shape_id ?? '',
        routeId: r.route_id ?? null,
        serviceId: r.service_id ?? null,
      }
    }
  }

  // calendar.txt → { serviceId: { monday..sunday, startDate, endDate } }
  const calendar = {}
  const calEntry = inner.getEntry('calendar.txt')
  if (calEntry) {
    for (const r of parseGtfsCsv(calEntry.getData().toString('utf8'))) {
      if (!r.service_id) continue
      calendar[r.service_id] = {
        monday: r.monday, tuesday: r.tuesday, wednesday: r.wednesday, thursday: r.thursday,
        friday: r.friday, saturday: r.saturday, sunday: r.sunday,
        startDate: r.start_date, endDate: r.end_date,
      }
    }
  }

  // calendar_dates.txt → { serviceId: { dateStr: exceptionType } } — per-date add(1)/remove(2) overrides
  const calendarExceptions = {}
  const calDatesEntry = inner.getEntry('calendar_dates.txt')
  if (calDatesEntry) {
    for (const r of parseGtfsCsv(calDatesEntry.getData().toString('utf8'))) {
      if (!r.service_id || !r.date) continue
      if (!calendarExceptions[r.service_id]) calendarExceptions[r.service_id] = {}
      calendarExceptions[r.service_id][r.date] = r.exception_type
    }
  }

  // stopId → trip IDs passing through it, for the departure-board lookup. This used to also copy
  // arrSecs/deptSecs (and before that, routeId/headsign/serviceId too) per stop-time — a full
  // second copy of `schedule`'s ~150k-4M rows indexed the other way round. Metro/tram have enough
  // stop-times that this duplication alone was worth several hundred MB; the actual times are
  // already sitting in `schedule[tripId]` and are cheap to look up there instead.
  const stopTripIndex = {}
  for (const [tripId, stopTimes] of Object.entries(schedule)) {
    if (!tripInfo[tripId]) continue
    for (const st of stopTimes) {
      if (!stopTripIndex[st.stopId]) stopTripIndex[st.stopId] = []
      stopTripIndex[st.stopId].push(tripId)
    }
  }

  // stops → name map, and parent_station (e.g. "vic:rail:JOR") → [stop_id,...]
  // Service alerts identify stops by parent_station, not the numeric stop_id the rest of the app uses.
  const stopNames = {}
  const parentStationStops = {}
  const stopsEntry = inner.getEntry('stops.txt')
  if (stopsEntry) {
    for (const r of parseGtfsCsv(stopsEntry.getData().toString('utf8'))) {
      if (!r.stop_id) continue
      stopNames[r.stop_id] = r.stop_name ?? ''
      if (r.parent_station) {
        if (!parentStationStops[r.parent_station]) parentStationStops[r.parent_station] = []
        parentStationStops[r.parent_station].push(r.stop_id)
      }
    }
  }

  // shapes → [[lat, lng], ...] sorted by sequence.
  // shapes.txt can be enormous for a statewide network (millions of survey-grade points), so this
  // skips both the generic per-row-object CSV parser AND ever materializing a full decompressed
  // string or an array of ~3M line-strings (a single vline load was peaking over 1GB from exactly
  // that). shape_id rows are contiguous in this feed, so this scans the raw buffer line-by-line and
  // decimates+flushes each shape as soon as its id changes, holding only one shape's raw points at
  // a time instead of every point of every shape simultaneously.
  const shapes = {}
  const shapesEntry = inner.getEntry('shapes.txt')
  if (shapesEntry) {
    const buf = shapesEntry.getData()
    const firstNewline = buf.indexOf(10)
    const header = splitCsvRow(buf.toString('utf8', 0, firstNewline).replace(/^﻿/, ''))
    const idIdx = header.indexOf('shape_id')
    const latIdx = header.indexOf('shape_pt_lat')
    const lonIdx = header.indexOf('shape_pt_lon')
    const seqIdx = header.indexOf('shape_pt_sequence')

    const MAX_POINTS_PER_SHAPE = 300
    function flushShape(id, points) {
      if (!id || !points.length) return
      points.sort((a, b) => a[2] - b[2])
      const stride = Math.max(1, Math.ceil(points.length / MAX_POINTS_PER_SHAPE))
      const decimated = []
      for (let i = 0; i < points.length; i += stride) decimated.push([points[i][0], points[i][1]])
      const last = points[points.length - 1]
      const lastKept = decimated[decimated.length - 1]
      if (lastKept && (lastKept[0] !== last[0] || lastKept[1] !== last[1])) decimated.push([last[0], last[1]])
      shapes[id] = decimated
    }

    let currentId = null
    let currentPoints = []
    const len = buf.length
    let lineStart = firstNewline + 1
    while (lineStart < len) {
      let lineEnd = buf.indexOf(10, lineStart)
      if (lineEnd === -1) lineEnd = len
      let end = lineEnd
      if (end > lineStart && buf[end - 1] === 13) end-- // trim trailing \r
      if (end > lineStart) {
        // Quoted fields again — see the stop_times.txt note above.
        const vals = splitCsvRow(buf.toString('utf8', lineStart, end))
        const id = vals[idIdx]
        if (id) {
          if (id !== currentId) {
            flushShape(currentId, currentPoints)
            currentId = id
            currentPoints = []
          }
          currentPoints.push([parseFloat(vals[latIdx]), parseFloat(vals[lonIdx]), parseInt(vals[seqIdx])])
        }
      }
      lineStart = lineEnd + 1
    }
    flushShape(currentId, currentPoints)
  }

  gtfsStatic[network] = { schedule, tripInfo, stopNames, shapes, calendar, calendarExceptions, stopTripIndex, parentStationStops }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const shapeCount = Object.keys(shapes).length
  console.log(`GTFS static ready (${network}): ${Object.keys(schedule).length} trips, ${stopTimeCount} stop times, ${shapeCount} shapes [${elapsed}s]`)

  // Parsing this briefly allocates hundreds of MB of transient buffers (raw CSV text, per-row
  // scratch arrays) that V8 doesn't hand back to the OS promptly on its own — on a memory-capped
  // host that peak is exactly what gets a process OOM-killed, even though the steady-state
  // requirement afterwards is a fraction of it. A single collection doesn't fully release large
  // buffers back to the OS; a few passes with small gaps reliably does.
  if (global.gc) {
    for (let i = 0; i < 4; i++) {
      global.gc()
      await new Promise(r => setTimeout(r, 200))
    }
  }
}

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function isServiceActiveOn(gs, serviceId, dateStr) {
  const exception = gs.calendarExceptions[serviceId]?.[dateStr]
  if (exception === '1') return true
  if (exception === '2') return false
  const cal = gs.calendar[serviceId]
  if (!cal) return false
  if (dateStr < cal.startDate || dateStr > cal.endDate) return false
  const dow = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8))).getUTCDay()
  return cal[WEEKDAY_KEYS[dow]] === '1'
}

// "YYYYMMDD" as of a given moment, in Melbourne's UTC+10 calendar date (matches the existing +10:00 convention below)
function melbDateStr(ms) {
  const shifted = new Date(ms + 10 * 3600 * 1000)
  const y = shifted.getUTCFullYear()
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}${mo}${d}`
}

function gtfsMidnightSecs(dateStr) {
  const y = dateStr.slice(0, 4), mo = dateStr.slice(4, 6), d = dateStr.slice(6, 8)
  return Math.floor(new Date(`${y}-${mo}-${d}T00:00:00+10:00`).getTime() / 1000)
}

// Bind the port immediately so the client can connect while GTFS parses in the background
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  // Check for a fresher GTFS bundle before doing the initial load, then keep checking daily
  refreshGtfsZip().finally(() => {
    loadGtfsStatic('vline').catch(e => console.error('GTFS vline load failed:', e.message))
  })
  setInterval(() => refreshGtfsZip(), GTFS_REFRESH_INTERVAL_MS)
})

// ── Trip update feed cache ────────────────────────────────────────────────────

const tripUpdateFeedCache = {}

// Persists per-stop delay data so past stops still show their last-known delay
// after they drop off the realtime feed. Structure: { tripId: { stopId: {...} } }
const stopDelayHistory = {}

function recordDelays(tripId, realtimeMap) {
  if (!stopDelayHistory[tripId]) stopDelayHistory[tripId] = {}
  Object.assign(stopDelayHistory[tripId], realtimeMap)
}

async function fetchTripUpdateFeed(network) {
  const c = tripUpdateFeedCache[network]
  if (c && (Date.now() - c.ts) < 25000) return c.feed
  const apiKey = process.env.API_KEY
  const response = await axios.get(TRIP_UPDATE_URLS[network], {
    headers: apiKey ? { KeyId: apiKey, 'Ocp-Apim-Subscription-Key': apiKey } : {},
    responseType: 'arraybuffer',
  })
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data))
  tripUpdateFeedCache[network] = { feed, ts: Date.now() }
  return feed
}

const serviceAlertFeedCache = {}

async function fetchServiceAlertFeed(network) {
  const c = serviceAlertFeedCache[network]
  if (c && (Date.now() - c.ts) < 60000) return c.feed
  const apiKey = process.env.API_KEY
  const response = await axios.get(SERVICE_ALERT_URLS[network], {
    headers: apiKey ? { KeyId: apiKey, 'Ocp-Apim-Subscription-Key': apiKey } : {},
    responseType: 'arraybuffer',
  })
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data))
  serviceAlertFeedCache[network] = { feed, ts: Date.now() }
  return feed
}

const ALERT_CAUSES = ['UNKNOWN_CAUSE', 'OTHER_CAUSE', 'TECHNICAL_PROBLEM', 'STRIKE', 'DEMONSTRATION', 'ACCIDENT', 'HOLIDAY', 'WEATHER', 'MAINTENANCE', 'CONSTRUCTION', 'POLICE_ACTIVITY', 'MEDICAL_EMERGENCY']
const ALERT_EFFECTS = ['NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'ADDITIONAL_SERVICE', 'MODIFIED_SERVICE', 'OTHER_EFFECT', 'UNKNOWN_EFFECT', 'STOP_MOVED', 'NO_EFFECT', 'ACCESSIBILITY_ISSUE']

function translatedText(field) {
  if (!field?.translation?.length) return null
  const en = field.translation.find(t => !t.language || t.language.startsWith('en'))
  return (en ?? field.translation[0]).text ?? null
}

function enumName(list, value) {
  if (value == null) return null
  return typeof value === 'string' ? value : (list[value] ?? null)
}

app.get('/api/service-alerts', async (req, res) => {
  const network = resolveNetwork(req.query.network)

  if (!gtfsStatic[network]) {
    loadGtfsStatic(network).catch(e => console.error(`GTFS ${network} load failed:`, e.message))
  }
  const parentStationStops = gtfsStatic[network]?.parentStationStops ?? {}

  try {
    const feed = await fetchServiceAlertFeed(network)
    const now = Math.floor(Date.now() / 1000)

    const alerts = feed.entity
      .filter(e => e.alert)
      .map(e => {
        const a = e.alert
        const activePeriods = (a.activePeriod ?? []).map(p => ({
          start: p.start != null ? Number(p.start) : null,
          end: p.end != null ? Number(p.end) : null,
        }))
        const isActive = !activePeriods.length || activePeriods.some(p =>
          (p.start == null || p.start <= now) && (p.end == null || p.end >= now)
        )
        return {
          id: e.id,
          cause: enumName(ALERT_CAUSES, a.cause),
          effect: enumName(ALERT_EFFECTS, a.effect),
          header: translatedText(a.headerText),
          description: translatedText(a.descriptionText),
          url: translatedText(a.url),
          activePeriods,
          isActive,
          informed: (a.informedEntity ?? []).map(ie => ({
            routeId: ie.routeId ?? null,
            stopId: ie.stopId ?? null,
            stopIds: ie.stopId ? (parentStationStops[ie.stopId] ?? [ie.stopId]) : [],
            tripId: ie.trip?.tripId ?? null,
          })),
        }
      })
      .filter(a => a.isActive)

    res.json({ alerts })
  } catch (err) {
    if (err.response) {
      console.error('Service alerts upstream error:', err.response.status)
    } else {
      console.error('Service alerts error:', err.message)
    }
    res.status(502).json({ error: 'Failed to fetch service alerts' })
  }
})

app.get('/api/vehicles', async (_req, res) => {
  const network = resolveNetwork(_req.query.network)
  const apiUrl = API_URLS[network]
  const apiKey = process.env.API_KEY

  console.log('API key present:', !!apiKey, '| length:', apiKey?.length, '| starts with:', apiKey?.slice(0, 4))

  try {
    const response = await axios.get(apiUrl, {
      headers: apiKey ? { KeyId: apiKey, 'Ocp-Apim-Subscription-Key': apiKey } : {},
      responseType: 'arraybuffer',
    })

    console.log('Upstream status:', response.status, '| bytes:', response.data.byteLength)

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(response.data)
    )

    const vehicles = feed.entity
      .filter(e => e.vehicle?.position)
      .map(e => ({
        id: e.id,
        tripId: e.vehicle.trip?.tripId ?? null,
        routeId: e.vehicle.trip?.routeId ?? null,
        startDate: e.vehicle.trip?.startDate ?? null,
        lat: e.vehicle.position.latitude,
        lng: e.vehicle.position.longitude,
        bearing: e.vehicle.position.bearing ?? null,
        speed: e.vehicle.position.speed != null
          ? Math.round(e.vehicle.position.speed * 3.6)
          : null,
        vehicleId: e.vehicle.vehicle?.id ?? null,
        timestamp: e.vehicle.timestamp ? Number(e.vehicle.timestamp) : null,
      }))

    console.log('Vehicles found:', vehicles.length)
    res.json({ vehicles, feedTimestamp: Number(feed.header.timestamp) })
  } catch (err) {
    if (err.response) {
      console.error('Upstream error:', err.response.status, err.response.headers['content-type'])
      const body = Buffer.from(err.response.data).toString('utf8')
      console.error('Response body:', body)
    } else {
      console.error('Error:', err.message)
    }
    res.status(502).json({ error: 'Failed to fetch vehicle positions from upstream API' })
  }
})

app.get('/api/trip-updates', async (_req, res) => {
  const network = resolveNetwork(_req.query.network)

  try {
    const feed = await fetchTripUpdateFeed(network)

    const updates = {}
    const now = Math.floor(Date.now() / 1000)
    for (const e of feed.entity) {
      const tu = e.tripUpdate
      if (!tu?.trip?.tripId) continue
      const sr = tu.trip.scheduleRelationship
      const cancelled = sr === 3 || sr === 'CANCELED' || sr === 'CANCELLED'
      const allStops = tu.stopTimeUpdate ?? []
      const n = (v) => (v != null ? Number(v) : null)
      const nextIdx = allStops.findIndex(s => {
        const deptTime = s.departure?.time ? Number(s.departure.time) : null
        return deptTime === null || deptTime >= now
      })
      const nextStu = nextIdx >= 0 ? allStops[nextIdx] : (allStops.at(-1) ?? null)
      const delay = nextStu?.arrival?.delay ?? nextStu?.departure?.delay ?? null
      updates[tu.trip.tripId] = {
        delay: delay != null ? Number(delay) : null,
        cancelled,
        nextStopId: nextStu?.stopId ?? null,
        stops: allStops.map(s => ({
          stopId: s.stopId,
          arrActual:  n(s.arrival?.time),
          arrDelay:   n(s.arrival?.delay),
          deptActual: n(s.departure?.time),
          deptDelay:  n(s.departure?.delay),
          isPast: s.departure?.time ? Number(s.departure.time) < now : false,
        })),
      }
    }

    res.json({ updates })
  } catch (err) {
    if (err.response) {
      console.error('Trip updates upstream error:', err.response.status)
      console.error('Trip updates error:', err.message)
    }
    res.status(502).json({ error: 'Failed to fetch trip updates' })
  }
})

app.get('/api/trip-schedule', async (req, res) => {
  const network = resolveNetwork(req.query.network)
  const { tripId, startDate } = req.query
  if (!tripId) return res.status(400).json({ error: 'tripId required' })

  if (!gtfsStatic[network]) {
    loadGtfsStatic(network).catch(e => console.error(`GTFS ${network} load failed:`, e.message))
    return res.json({ stops: [], loading: true, headsign: null })
  }

  const gs = gtfsStatic[network]
  const staticStops = gs.schedule[tripId]
  if (!staticStops?.length) return res.json({ stops: [], headsign: null })

  // startDate "20260706" → midnight AEST (UTC+10)
  let midnight = null
  if (startDate?.length === 8) {
    const y = startDate.slice(0, 4), mo = startDate.slice(4, 6), d = startDate.slice(6, 8)
    midnight = Math.floor(new Date(`${y}-${mo}-${d}T00:00:00+10:00`).getTime() / 1000)
  }

  const now = Math.floor(Date.now() / 1000)

  // Overlay realtime delays from cached feed
  const realtimeMap = {}
  try {
    const feed = await fetchTripUpdateFeed(network)
    const entity = feed.entity.find(e => e.tripUpdate?.trip?.tripId === tripId)
    for (const stu of entity?.tripUpdate?.stopTimeUpdate ?? []) {
      const n = v => v != null ? Number(v) : null
      realtimeMap[stu.stopId] = {
        arrDelay:   n(stu.arrival?.delay),
        deptDelay:  n(stu.departure?.delay),
        arrActual:  n(stu.arrival?.time),
        deptActual: n(stu.departure?.time),
      }
    }
  } catch {}

  recordDelays(tripId, realtimeMap)

  const stops = staticStops.map(s => {
    const schedArr  = midnight !== null && s.arrSecs  !== null ? midnight + s.arrSecs  : null
    const schedDept = midnight !== null && s.deptSecs !== null ? midnight + s.deptSecs : null
    const rt = realtimeMap[s.stopId] ?? stopDelayHistory[tripId]?.[s.stopId]
    const estArr  = rt?.arrActual  ?? (schedArr  !== null && rt?.arrDelay  != null ? schedArr  + rt.arrDelay  : null)
    const estDept = rt?.deptActual ?? (schedDept !== null && rt?.deptDelay != null ? schedDept + rt.deptDelay : null)
    const delay = rt?.arrDelay ?? rt?.deptDelay ?? null
    const deptTime = estDept ?? schedDept
    return {
      stopId: s.stopId,
      name: gs.stopNames[s.stopId] ?? s.stopId,
      schedArr,
      schedDept,
      estArr,
      estDept,
      delay,
      isPast: deptTime !== null ? deptTime < now : false,
    }
  })

  res.json({ stops, headsign: gs.tripInfo[tripId]?.headsign ?? null })
})

app.get('/api/trip-shape', (req, res) => {
  const network = resolveNetwork(req.query.network)
  const { tripId } = req.query
  if (!tripId) return res.status(400).json({ error: 'tripId required' })
  const gs = gtfsStatic[network]
  if (!gs) return res.json({ shape: null, loading: true })
  const shapeId = gs.tripInfo[tripId]?.shapeId
  const shape = shapeId ? (gs.shapes[shapeId] ?? null) : null
  res.json({ shape })
})

app.get('/api/stops', (req, res) => {
  const network = resolveNetwork(req.query.network)
  try {
    const mode = STOP_MODES[network]
    const stops = getAllStops().filter(s => s.mode === mode)
    res.json({ stops })
  } catch (err) {
    console.error(`Failed to load stops (${network}):`, err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/stop-departures', async (req, res) => {
  const network = resolveNetwork(req.query.network)
  const { stopId } = req.query
  const limit = Math.min(parseInt(req.query.limit) || 8, 30)
  if (!stopId) return res.status(400).json({ error: 'stopId required' })

  if (!gtfsStatic[network]) {
    loadGtfsStatic(network).catch(e => console.error(`GTFS ${network} load failed:`, e.message))
    return res.json({ departures: [], loading: true })
  }

  const gs = gtfsStatic[network]
  const tripIds = gs.stopTripIndex[stopId] ?? []
  if (!tripIds.length) return res.json({ departures: [] })

  const nowMs = Date.now()
  const nowSecs = Math.floor(nowMs / 1000)
  const todayStr = melbDateStr(nowMs)
  const yesterdayStr = melbDateStr(nowMs - 86400000)
  const todayMidnight = gtfsMidnightSecs(todayStr)
  const yesterdayMidnight = gtfsMidnightSecs(yesterdayStr)

  const upcoming = []
  for (const tripId of tripIds) {
    // arrSecs/deptSecs live on schedule[tripId] rather than being duplicated per stop as well
    const st = gs.schedule[tripId]?.find(s => s.stopId === stopId)
    if (!st) continue
    const t = st.deptSecs ?? st.arrSecs
    if (t == null) continue
    const info = gs.tripInfo[tripId]
    const serviceId = info?.serviceId
    // Today's own service
    if (isServiceActiveOn(gs, serviceId, todayStr)) {
      const absSecs = todayMidnight + t
      if (absSecs >= nowSecs) upcoming.push({ tripId, routeId: info?.routeId, headsign: info?.headsign, absSecs })
    }
    // Yesterday's service running past midnight (GTFS times can exceed 24:00:00) into this morning
    if (t >= 86400 && isServiceActiveOn(gs, serviceId, yesterdayStr)) {
      const absSecs = yesterdayMidnight + t
      if (absSecs >= nowSecs) upcoming.push({ tripId, routeId: info?.routeId, headsign: info?.headsign, absSecs })
    }
  }
  upcoming.sort((a, b) => a.absSecs - b.absSecs)
  const nextDepartures = upcoming.slice(0, limit)

  // Overlay realtime delay/cancellation for whichever of these trips are currently in the feed.
  // Some networks' realtime trip IDs never agree with their own static trip_id (Metro's GTFS-RT
  // uses a different ID scheme entirely) so an exact-tripId match alone would silently find nothing —
  // fall back to the nearest same-route candidate at this stop within a plausible delay window.
  const realtimeCandidates = []
  try {
    const feed = await fetchTripUpdateFeed(network)
    for (const e of feed.entity) {
      const tu = e.tripUpdate
      if (!tu?.trip) continue
      const stu = (tu.stopTimeUpdate ?? []).find(s => s.stopId === stopId)
      if (!stu) continue
      const sr = tu.trip.scheduleRelationship
      realtimeCandidates.push({
        tripId: tu.trip.tripId ?? null,
        routeId: tu.trip.routeId ?? null,
        delay: stu.departure?.delay ?? stu.arrival?.delay ?? null,
        actual: stu.departure?.time ? Number(stu.departure.time) : (stu.arrival?.time ? Number(stu.arrival.time) : null),
        cancelled: sr === 3 || sr === 'CANCELED' || sr === 'CANCELLED',
      })
    }
  } catch {}

  const RT_MATCH_WINDOW_SECS = 6 * 60
  const usedCandidates = new Set()
  function matchRealtime(d) {
    const exact = realtimeCandidates.find(c => !usedCandidates.has(c) && c.tripId === d.tripId)
    if (exact) return exact
    let best = null, bestDiff = Infinity
    for (const c of realtimeCandidates) {
      if (usedCandidates.has(c) || c.routeId !== d.routeId || c.actual == null) continue
      const diff = Math.abs(c.actual - d.absSecs)
      if (diff <= RT_MATCH_WINDOW_SECS && diff < bestDiff) { best = c; bestDiff = diff }
    }
    return best
  }

  const departures = nextDepartures.map(d => {
    const rt = matchRealtime(d)
    if (rt) usedCandidates.add(rt)
    const delayMins = rt?.delay != null ? Math.round(rt.delay / 60) : null
    const estTime = rt?.actual ?? (rt?.delay != null ? d.absSecs + rt.delay : null)
    return {
      tripId: d.tripId,
      routeId: d.routeId,
      headsign: d.headsign,
      schedTime: d.absSecs,
      estTime,
      delayMins,
      cancelled: rt?.cancelled ?? false,
    }
  })

  res.json({ departures })
})

// In production the built client (client/dist) is served from this same process/port,
// so the deployed app is a single web service with no cross-origin API calls.
const clientDist = join(__dirname, '../client/dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'))
  })
}
