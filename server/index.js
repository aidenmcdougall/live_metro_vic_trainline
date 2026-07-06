import express from 'express'
import cors from 'cors'
import axios from 'axios'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import AdmZip from 'adm-zip'
import { readFileSync } from 'fs'
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
}

const TRIP_UPDATE_URLS = {
  vline: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline/trip-updates',
  metro: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/trip-updates',
}

const STOP_MODES = {
  vline: 'REGIONAL TRAIN',
  metro: 'METRO TRAIN',
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

const GTFS_INNER_ZIPS = { vline: '1/google_transit.zip', metro: '2/google_transit.zip' }
const gtfsStatic = {}

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
  console.log(`Loading GTFS static for ${network}...`)
  const t0 = Date.now()

  const outer = new AdmZip(join(__dirname, 'gtfs.zip'))
  const innerEntry = outer.getEntry(GTFS_INNER_ZIPS[network])
  if (!innerEntry) throw new Error(`Inner zip not found: ${GTFS_INNER_ZIPS[network]}`)
  const inner = new AdmZip(innerEntry.getData())

  // stop_times → schedule map
  const stEntry = inner.getEntry('stop_times.txt')
  if (!stEntry) throw new Error('stop_times.txt not found')
  const stRows = parseGtfsCsv(stEntry.getData().toString('utf8'))
  const schedule = {}
  for (const r of stRows) {
    if (!r.trip_id) continue
    if (!schedule[r.trip_id]) schedule[r.trip_id] = []
    schedule[r.trip_id].push({
      stopId: r.stop_id,
      seq: parseInt(r.stop_sequence) || 0,
      arrSecs: gtfsTimeToSecs(r.arrival_time),
      deptSecs: gtfsTimeToSecs(r.departure_time),
    })
  }
  for (const tid of Object.keys(schedule)) schedule[tid].sort((a, b) => a.seq - b.seq)

  // trips → { headsign, shapeId }
  const tripInfo = {}
  const tripsEntry = inner.getEntry('trips.txt')
  if (tripsEntry) {
    for (const r of parseGtfsCsv(tripsEntry.getData().toString('utf8'))) {
      if (r.trip_id) tripInfo[r.trip_id] = { headsign: r.trip_headsign ?? '', shapeId: r.shape_id ?? '' }
    }
  }

  // stops → name map
  const stopNames = {}
  const stopsEntry = inner.getEntry('stops.txt')
  if (stopsEntry) {
    for (const r of parseGtfsCsv(stopsEntry.getData().toString('utf8'))) {
      if (r.stop_id) stopNames[r.stop_id] = r.stop_name ?? ''
    }
  }

  // shapes → [[lat, lng], ...] sorted by sequence
  const shapes = {}
  const shapesEntry = inner.getEntry('shapes.txt')
  if (shapesEntry) {
    const pts = {}
    for (const r of parseGtfsCsv(shapesEntry.getData().toString('utf8'))) {
      if (!r.shape_id) continue
      if (!pts[r.shape_id]) pts[r.shape_id] = []
      pts[r.shape_id].push([parseFloat(r.shape_pt_lat), parseFloat(r.shape_pt_lon), parseInt(r.shape_pt_sequence)])
    }
    for (const id of Object.keys(pts)) {
      pts[id].sort((a, b) => a[2] - b[2])
      shapes[id] = pts[id].map(p => [p[0], p[1]])
    }
  }

  gtfsStatic[network] = { schedule, tripInfo, stopNames, shapes }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const shapeCount = Object.keys(shapes).length
  console.log(`GTFS static ready (${network}): ${Object.keys(schedule).length} trips, ${stRows.length} stop times, ${shapeCount} shapes [${elapsed}s]`)
}

// Bind the port immediately so the client can connect while GTFS parses in the background
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  // Load V/Line GTFS after port is bound; Metro loads lazily on first request
  loadGtfsStatic('vline').catch(e => console.error('GTFS vline load failed:', e.message))
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

app.get('/api/vehicles', async (_req, res) => {
  const network = _req.query.network === 'metro' ? 'metro' : 'vline'
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
  const network = _req.query.network === 'metro' ? 'metro' : 'vline'

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
  const network = req.query.network === 'metro' ? 'metro' : 'vline'
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
  const network = req.query.network === 'metro' ? 'metro' : 'vline'
  const { tripId } = req.query
  if (!tripId) return res.status(400).json({ error: 'tripId required' })
  const gs = gtfsStatic[network]
  if (!gs) return res.json({ shape: null, loading: true })
  const shapeId = gs.tripInfo[tripId]?.shapeId
  const shape = shapeId ? (gs.shapes[shapeId] ?? null) : null
  res.json({ shape })
})

app.get('/api/stops', (req, res) => {
  const network = req.query.network === 'metro' ? 'metro' : 'vline'
  try {
    const mode = STOP_MODES[network]
    const stops = getAllStops().filter(s => s.mode === mode)
    res.json({ stops })
  } catch (err) {
    console.error(`Failed to load stops (${network}):`, err.message)
    res.status(500).json({ error: err.message })
  }
})

