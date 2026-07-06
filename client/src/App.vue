<template>
  <div class="app-shell">
    <Toolbar class="app-toolbar">
      <template #start>
        <span class="app-title">🚆 Live Train Tracker</span>
      </template>
      <template #end>
        <div class="toolbar-end">
          <SelectButton
            v-model="network"
            :options="networkOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
          <Tag
            v-if="!error"
            :value="`${vehicles.length} trains`"
            severity="success"
            icon="pi pi-map-marker"
          />
          <Tag v-if="error" value="API error" severity="danger" icon="pi pi-exclamation-triangle" />
          <span v-if="lastUpdated" class="last-updated">
            Updated {{ lastUpdated }}
          </span>
          <Button
            icon="pi pi-refresh"
            :loading="loading"
            @click="refresh"
            rounded
            text
            aria-label="Refresh"
          />
        </div>
      </template>
    </Toolbar>

    <div class="map-wrapper">
      <TrainMap ref="trainMapRef" :vehicles="vehicles" :stops="stops" :color="networkColor" :network="network" :selected-id="selectedVehicleId" :route-polyline="routePolyline" @train-selected="onTrainSelected" />
      <ProgressBar v-if="loading && vehicles.length === 0" mode="indeterminate" class="loading-bar" />

      <div class="delay-panel" v-if="delayedVehicles.length">
        <div class="delay-panel__title">Delays</div>
        <div class="delay-panel__list">
          <div
            v-for="v in delayedVehicles"
            :key="v.id"
            class="delay-row"
            :class="{ 'delay-row--cancelled': v.cancelled }"
            @click="trainMapRef?.focusVehicle(v.id)"
          >
            <span class="delay-row__label">{{ v.vehicleId ?? '—' }}</span>
            <span class="delay-row__sep">·</span>
            <span class="delay-row__route">{{ routeCode(v.routeId) }}</span>
            <span class="delay-row__sep">·</span>
            <span class="delay-row__badge" :class="v.cancelled ? 'badge--cancelled' : 'badge--delayed'">
              {{ v.cancelled ? 'CANC' : `+${Math.round(v.delay / 60)}m` }}
            </span>
          </div>
        </div>
      </div>

      <!-- Right detail panel -->
      <Transition name="panel-slide">
        <div v-if="selectedVehicle" class="train-detail-panel" :style="{ '--net-color': networkColor }">
          <div class="tdp-image-wrap" v-if="fleetImageSrc">
            <img :src="fleetImageSrc" :alt="selectedFleet?.type" class="tdp-image" />
            <button class="tdp-close tdp-close--on-image" @click="selectedVehicleId = null">✕</button>
          </div>

          <div class="tdp-header" :class="{ 'tdp-header--no-top': !!fleetImageSrc }">
            <div class="tdp-header-main">
              <div class="tdp-vehicle-id">{{ selectedVehicle.vehicleId ?? selectedVehicle.tripId ?? '—' }}</div>
              <div v-if="tripSchedule.headsign" class="tdp-headsign">→ {{ tripSchedule.headsign }}</div>
              <template v-if="selectedFleet">
                <div class="tdp-fleet-row">
                  <div class="tdp-fleet-badge">{{ selectedFleet.type }}</div>
                  <div v-if="selectedFleet.set" class="tdp-fleet-set">{{ selectedFleet.set }}</div>
                </div>
                <div class="tdp-fleet-desc">{{ selectedFleet.meta.description }}</div>
              </template>
            </div>
            <button class="tdp-close" v-if="!fleetImageSrc" @click="selectedVehicleId = null">✕</button>
          </div>

          <div v-if="selectedFleet" class="tdp-consist">
            <div class="tdp-section-label">Consist</div>
            <div class="tdp-consist-list">{{ selectedFleet.consist.join(' · ') }}</div>
          </div>

          <!-- Stop timeline -->
          <div v-if="tripSchedule.loading && !visibleTripStops.length" class="tdp-tl-loading">
            Loading schedule...
          </div>
          <div v-if="visibleTripStops.length" class="tdp-timeline">
            <div class="tdp-section-label" style="padding: 0 14px 8px">Stops</div>
            <div
              v-for="(stop, i) in visibleTripStops"
              :key="stop.stopId + i"
              class="tdp-tl-stop"
              :class="{ 'tdp-tl-stop--past': stop.isPast, 'tdp-tl-stop--next': stop.isNext }"
            >
              <div class="tdp-tl-marker">
                <div class="tdp-tl-dot"></div>
                <div v-if="i < visibleTripStops.length - 1" class="tdp-tl-line"></div>
              </div>
              <div class="tdp-tl-content">
                <div class="tdp-tl-name">{{ stop.name }}</div>
                <div class="tdp-tl-times">
                  <span v-if="stop.scheduledTime" class="tdp-tl-sch">{{ stop.scheduledTime }}</span>
                  <span class="tdp-tl-time">{{ stop.displayTime }}</span>
                  <span v-if="stop.delayMins" class="tdp-tl-delay" :class="stop.delayMins > 0 ? 'tdp-tl-delay--late' : 'tdp-tl-delay--early'">
                    {{ stop.delayMins > 0 ? '+' + stop.delayMins + 'm' : stop.delayMins + 'm' }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="tdp-fields">
            <div class="tdp-row">
              <span class="tdp-key">Status</span>
              <span :class="['tdp-val', tdpStatusClass]">{{ tdpStatusText }}</span>
            </div>
            <div class="tdp-row">
              <span class="tdp-key">Route</span>
              <span class="tdp-val">{{ routeCode(selectedVehicle.routeId) }}</span>
            </div>
            <div class="tdp-row">
              <span class="tdp-key">Trip</span>
              <span class="tdp-val tdp-val--mono">{{ selectedVehicle.tripId ?? '—' }}</span>
            </div>
            <div v-if="selectedVehicle.speed != null" class="tdp-row">
              <span class="tdp-key">Speed</span>
              <span class="tdp-val">{{ selectedVehicle.speed }} km/h</span>
            </div>
            <div class="tdp-row">
              <span class="tdp-key">Bearing</span>
              <span class="tdp-val">{{ selectedVehicle.bearing != null ? selectedVehicle.bearing + '°' : '—' }}</span>
            </div>
            <div class="tdp-row">
              <span class="tdp-key">Updated</span>
              <span class="tdp-val">{{ tdpUpdatedTime }}</span>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import Toolbar from 'primevue/toolbar'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import SelectButton from 'primevue/selectbutton'
import TrainMap from './components/TrainMap.vue'
import { getFleetInfo } from './data/metro-fleet.js'
import { getVLineFleetInfo } from './data/vline-fleet.js'

const networkOptions = [
  { label: 'V/Line', value: 'vline' },
  { label: 'Metro',  value: 'metro' },
]

const NETWORK_COLORS = {
  vline: '#a855f7',
  metro: '#3b82f6',
}

const trainMapRef = ref(null)
const network = ref('vline')
const networkColor = computed(() => NETWORK_COLORS[network.value])

function routeCode(routeId) {
  return routeId?.split('-').pop()?.replace(/:/g, '') ?? '—'
}

const delayedVehicles = computed(() => {
  return vehicles.value
    .filter(v => v.cancelled || (v.delay != null && v.delay >= 60))
    .sort((a, b) => {
      if (a.cancelled && !b.cancelled) return -1
      if (!a.cancelled && b.cancelled) return 1
      return (b.delay ?? 0) - (a.delay ?? 0)
    })
})

const selectedVehicleId = ref(null)

const selectedVehicle = computed(() =>
  vehicles.value.find(v => v.id === selectedVehicleId.value) ?? null
)

function cleanStopName(name) {
  if (!name) return null
  return name.replace(/ Railway Station.*$/i, '').replace(/ Station$/i, '').toUpperCase()
}

function formatJourneyTime(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })
}

const nextStopName = computed(() => {
  const id = selectedVehicle.value?.nextStopId
  if (!id) return null
  return stopsMap.value[id] ?? null
})

const tripSchedule = ref({ stops: [], loading: false, headsign: null })

const visibleTripStops = computed(() => {
  // Full schedule from static GTFS
  if (tripSchedule.value.stops.length) {
    const stops = tripSchedule.value.stops
    const nextIdx = stops.findIndex(s => !s.isPast)
    return stops.map((s, i) => {
      const displayTs = s.estDept ?? s.estArr ?? s.schedDept ?? s.schedArr
      const scheduledTs = s.schedDept ?? s.schedArr
      const delayMins = s.delay ? Math.round(s.delay / 60) : 0
      return {
        ...s,
        name: cleanStopName(s.name) ?? s.stopId,
        displayTime: formatJourneyTime(displayTs),
        scheduledTime: scheduledTs && displayTs && scheduledTs !== displayTs
          ? formatJourneyTime(scheduledTs) : null,
        delayMins: Math.abs(delayMins) >= 1 ? delayMins : 0,
        isNext: i === nextIdx,
      }
    })
  }
  // Fallback: realtime-only stops while static schedule loads
  const stops = selectedVehicle.value?.stops ?? []
  if (!stops.length) return []
  const nextIdx = stops.findIndex(s => !s.isPast)
  return stops.map((s, i) => {
    const actual = s.arrActual ?? s.deptActual
    const delay = s.arrDelay ?? s.deptDelay ?? 0
    const scheduled = actual && delay ? actual - delay : null
    const delayMins = Math.round(delay / 60)
    return {
      ...s,
      name: cleanStopName(stopsMap.value[s.stopId]) ?? s.stopId,
      displayTime: formatJourneyTime(actual),
      scheduledTime: scheduled && scheduled !== actual ? formatJourneyTime(scheduled) : null,
      delayMins: Math.abs(delayMins) >= 1 ? delayMins : 0,
      isNext: i === nextIdx,
    }
  })
})

const FLEET_IMAGES = {
  'VLocity': '/VLocity.jpg',
  'N type': '/NTrain.jpg',
}

const fleetImageSrc = computed(() => FLEET_IMAGES[selectedFleet.value?.type] ?? null)

const selectedFleet = computed(() => {
  if (!selectedVehicle.value) return null
  if (network.value === 'metro') return getFleetInfo(selectedVehicle.value.vehicleId)
  if (network.value === 'vline') return getVLineFleetInfo(selectedVehicle.value.vehicleId)
  return null
})

const tdpStatusClass = computed(() => {
  const v = selectedVehicle.value
  if (!v) return ''
  if (v.cancelled) return 'tdp-val--cancelled'
  if (v.delay != null && v.delay >= 60) return 'tdp-val--delayed'
  return 'tdp-val--ontime'
})

const tdpStatusText = computed(() => {
  const v = selectedVehicle.value
  if (!v) return '—'
  if (v.cancelled) return 'Cancelled'
  if (v.delay != null && v.delay >= 60) return `+${Math.round(v.delay / 60)} min late`
  return 'On time'
})

const tdpUpdatedTime = computed(() => {
  const ts = selectedVehicle.value?.timestamp
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
})

function onTrainSelected(id) {
  selectedVehicleId.value = id
}

const vehicles = ref([])
const stops = ref([])
const stopsMap = computed(() => {
  const m = {}
  for (const s of stops.value) m[s.id] = s.name
  return m
})

const stopCoordsMap = computed(() => {
  const m = {}
  for (const s of stops.value) m[s.id] = { lat: s.lat, lng: s.lng }
  return m
})

const tripShape = ref(null)

async function fetchTripShape(tripId) {
  if (!tripId) { tripShape.value = null; return }
  try {
    const res = await fetch(`/api/trip-shape?tripId=${encodeURIComponent(tripId)}&network=${network.value}`)
    if (!res.ok) return
    const data = await res.json()
    tripShape.value = data.shape ?? null
  } catch (e) {
    console.warn('Trip shape fetch failed:', e.message)
  }
}

function closestShapeIndex(shape, lat, lng) {
  let minD = Infinity, idx = 0
  for (let i = 0; i < shape.length; i++) {
    const d = (shape[i][0] - lat) ** 2 + (shape[i][1] - lng) ** 2
    if (d < minD) { minD = d; idx = i }
  }
  return idx
}

const routePolyline = computed(() => {
  const v = selectedVehicle.value
  if (!v) return null

  // Use real track geometry when available
  const shape = tripShape.value
  if (shape?.length >= 2) {
    const splitIdx = closestShapeIndex(shape, v.lat, v.lng)
    return {
      past:   shape.slice(0, splitIdx + 1),
      future: shape.slice(splitIdx),
      color:  networkColor.value,
    }
  }

  // Fallback: straight lines stop-to-stop
  if (!visibleTripStops.value.length) return null
  const coords = stopCoordsMap.value
  const past = [], future = []
  for (const stop of visibleTripStops.value) {
    const c = coords[stop.stopId]
    if (!c) continue
    if (stop.isPast) past.push([c.lat, c.lng])
    else future.push([c.lat, c.lng])
  }
  if (past.length) past.push([v.lat, v.lng])
  future.unshift([v.lat, v.lng])
  return { past, future, color: networkColor.value }
})
const loading = ref(false)
const error = ref(null)
const lastUpdated = ref(null)

let pollInterval = null

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const [vehiclesRes, updatesRes] = await Promise.all([
      fetch(`/api/vehicles?network=${network.value}`),
      fetch(`/api/trip-updates?network=${network.value}`),
    ])
    if (!vehiclesRes.ok) throw new Error(`HTTP ${vehiclesRes.status}`)
    const vehiclesData = await vehiclesRes.json()
    const updates = updatesRes.ok ? (await updatesRes.json()).updates ?? {} : {}

    vehicles.value = vehiclesData.vehicles.map(v => ({
      ...v,
      delay: updates[v.tripId]?.delay ?? null,
      cancelled: updates[v.tripId]?.cancelled ?? false,
      nextStopId: updates[v.tripId]?.nextStopId ?? null,
      stops: updates[v.tripId]?.stops ?? [],
    }))

    const d = new Date()
    lastUpdated.value = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

    const sv = selectedVehicle.value
    if (sv) fetchTripSchedule(sv.tripId, sv.startDate, true)
  } catch (e) {
    error.value = e.message
    console.error('Fetch error:', e)
  } finally {
    loading.value = false
  }
}

async function fetchStops() {
  try {
    const res = await fetch(`/api/stops?network=${network.value}`)
    if (!res.ok) { console.warn('Stops fetch failed:', res.status); return }
    const data = await res.json()
    stops.value = data.stops ?? []
  } catch (e) {
    console.warn('Stops fetch error:', e.message)
  }
}

async function fetchTripSchedule(tripId, startDate, silent = false) {
  if (!tripId) { tripSchedule.value = { stops: [], loading: false, headsign: null }; return }
  if (!silent) tripSchedule.value = { stops: [], loading: true, headsign: null }
  try {
    const params = new URLSearchParams({ tripId, network: network.value })
    if (startDate) params.set('startDate', startDate)
    const res = await fetch(`/api/trip-schedule?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    tripSchedule.value = {
      stops: data.stops ?? [],
      loading: data.loading ?? false,
      headsign: data.headsign ?? null,
    }
    // GTFS still loading server-side — retry after 2 s
    if (data.loading) {
      setTimeout(() => {
        if (selectedVehicle.value?.tripId === tripId) fetchTripSchedule(tripId, startDate)
      }, 2000)
    }
  } catch (e) {
    console.warn('Trip schedule fetch failed:', e.message)
    if (!silent) tripSchedule.value = { stops: [], loading: false, headsign: null }
  }
}

watch(selectedVehicle, (v) => {
  if (v) {
    fetchTripSchedule(v.tripId, v.startDate)
    fetchTripShape(v.tripId)
  } else {
    tripSchedule.value = { stops: [], loading: false, headsign: null }
    tripShape.value = null
  }
})

watch(network, () => {
  vehicles.value = []
  stops.value = []
  tripSchedule.value = { stops: [], loading: false, headsign: null }
  tripShape.value = null
  refresh()
  fetchStops()
})

onMounted(() => {
  refresh()
  fetchStops()
  pollInterval = setInterval(refresh, 30_000)
})

onUnmounted(() => clearInterval(pollInterval))
</script>

<style>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-toolbar {
  flex-shrink: 0;
  border-radius: 0 !important;
  border-left: none !important;
  border-right: none !important;
  border-top: none !important;
  background: #0f0f0f !important;
  border-bottom-color: #2a2a2a !important;
}

.app-title {
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.toolbar-end {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.last-updated {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.map-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.loading-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  height: 3px !important;
}

.delay-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  background: rgba(15, 15, 20, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  min-width: 160px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 10px 0 6px;
}

.delay-panel__title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  padding: 0 12px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 4px;
}

.delay-panel__list {
  display: flex;
  flex-direction: column;
}

.delay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 12px;
  font-size: 0.8rem;
}

.delay-row {
  cursor: pointer;
}

.delay-row:hover {
  background: rgba(255,255,255,0.07);
}

.delay-row__label {
  color: #e2e8f0;
  white-space: nowrap;
}

.delay-row__route {
  color: #6b7280;
  font-size: 0.72rem;
  white-space: nowrap;
}

.delay-row__sep {
  color: #374151;
  font-size: 0.72rem;
}

.delay-row--cancelled .delay-row__label {
  color: #9ca3af;
  text-decoration: line-through;
}

.delay-row__badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
}

.badge--delayed   { background: #92400e; color: #fbbf24; }
.badge--cancelled { background: #7f1d1d; color: #fca5a5; }

/* Left detail panel */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  transform: translateX(calc(-100% - 24px));
  opacity: 0;
}

.train-detail-panel {
  position: absolute;
  top: 12px;
  left: 12px;
  bottom: 12px;
  width: 280px;
  background: rgba(10, 10, 16, 0.95);
  backdrop-filter: blur(16px);
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 8px 40px rgba(0,0,0,0.55);
  z-index: 1001;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.tdp-image-wrap {
  position: relative;
  width: 100%;
  height: 160px;
  flex-shrink: 0;
  overflow: hidden;
}

.tdp-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tdp-close--on-image {
  position: absolute !important;
  top: 10px;
  right: 10px;
  background: rgba(0,0,0,0.5) !important;
  backdrop-filter: blur(4px);
  color: #e2e8f0 !important;
}

.tdp-close--on-image:hover {
  background: rgba(0,0,0,0.75) !important;
}

.tdp-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 18px 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}

.tdp-header--no-top {
  padding-top: 14px;
}

.tdp-header-main {
  flex: 1;
  min-width: 0;
}

.tdp-vehicle-id {
  font-size: 1.05rem;
  font-weight: 700;
  color: #f1f5f9;
  word-break: break-all;
  line-height: 1.3;
  margin-bottom: 8px;
}

.tdp-headsign {
  font-size: 0.78rem;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 6px;
}

.tdp-fleet-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}

.tdp-fleet-badge {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 20px;
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.tdp-fleet-set {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6b7280;
}

.tdp-fleet-desc {
  font-size: 0.72rem;
  color: #4b5563;
}

.tdp-close {
  flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  border: none;
  color: #6b7280;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  margin-top: 2px;
}

.tdp-close:hover {
  background: rgba(255,255,255,0.12);
  color: #e2e8f0;
}

.tdp-consist {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.tdp-section-label {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #374151;
  margin-bottom: 6px;
}

.tdp-consist-list {
  font-size: 0.76rem;
  color: #6b7280;
  line-height: 1.7;
  word-break: break-all;
}

.tdp-fields {
  padding: 8px 0;
}

.tdp-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 5px 14px;
  font-size: 0.8rem;
}

.tdp-row:hover {
  background: rgba(255,255,255,0.03);
}

.tdp-key {
  color: #4b5563;
  flex-shrink: 0;
  margin-right: 10px;
}

.tdp-val {
  color: #d1d5db;
  text-align: right;
}

.tdp-val--mono {
  font-size: 0.7rem;
  color: #6b7280;
  word-break: break-all;
  text-align: right;
}

.tdp-val--ontime   { color: #4ade80; }
.tdp-val--delayed  { color: #fbbf24; font-weight: 600; }
.tdp-val--cancelled { color: #f87171; font-weight: 600; }

.tdp-tl-loading {
  padding: 14px 14px;
  font-size: 0.72rem;
  color: #374151;
  font-style: italic;
}

/* Stop timeline */
.tdp-timeline {
  padding: 12px 0 4px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.tdp-tl-stop {
  display: flex;
  gap: 10px;
  padding: 0 14px;
}

.tdp-tl-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding-top: 5px;
}

.tdp-tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--net-color) 18%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--net-color) 70%, transparent);
}

.tdp-tl-stop--past .tdp-tl-dot {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.1);
}

.tdp-tl-stop--next .tdp-tl-dot {
  width: 9px;
  height: 9px;
  background: #f1f5f9;
  border-color: #f1f5f9;
  box-shadow: 0 0 7px rgba(255,255,255,0.55);
  margin-top: -1px;
}

.tdp-tl-line {
  width: 1.5px;
  flex: 1;
  min-height: 10px;
  background: color-mix(in srgb, var(--net-color) 35%, transparent);
  margin: 3px 0 0;
}

.tdp-tl-stop--past .tdp-tl-line {
  background: rgba(255,255,255,0.06);
}

.tdp-tl-content {
  flex: 1;
  min-width: 0;
  padding-bottom: 14px;
}

.tdp-tl-name {
  font-size: 0.74rem;
  font-weight: 700;
  color: #d1d5db;
  letter-spacing: 0.01em;
  margin-bottom: 2px;
}

.tdp-tl-stop--past .tdp-tl-name  { color: #374151; }
.tdp-tl-stop--next .tdp-tl-name  { color: #f1f5f9; }

.tdp-tl-times {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.tdp-tl-time {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6b7280;
}

.tdp-tl-stop--past .tdp-tl-time { color: #374151; }
.tdp-tl-stop--next .tdp-tl-time { color: #d1d5db; }

.tdp-tl-sch {
  font-size: 0.72rem;
  font-weight: 600;
  color: #4b5563;
  text-decoration: line-through;
}

.tdp-tl-delay {
  font-size: 0.63rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
}

.tdp-tl-delay--late  { background: #92400e; color: #fbbf24; }
.tdp-tl-delay--early { background: #14532d; color: #4ade80; }
</style>
