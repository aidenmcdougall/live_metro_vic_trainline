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
      <TrainMap ref="trainMapRef" :vehicles="vehicles" :color="networkColor" :network="network" :selected-id="selectedVehicleId" @train-selected="onTrainSelected" />
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
        <div v-if="selectedVehicle" class="train-detail-panel">
          <div class="tdp-image-wrap" v-if="selectedFleet?.type === 'VLocity'">
            <img src="/VLocity.jpg" alt="VLocity" class="tdp-image" />
            <button class="tdp-close tdp-close--on-image" @click="selectedVehicleId = null">✕</button>
          </div>

          <div class="tdp-header" :class="{ 'tdp-header--no-top': selectedFleet?.type === 'VLocity' }">
            <div class="tdp-header-main">
              <div class="tdp-vehicle-id">{{ selectedVehicle.vehicleId ?? selectedVehicle.tripId ?? '—' }}</div>
              <template v-if="selectedFleet">
                <div class="tdp-fleet-row">
                  <div class="tdp-fleet-badge">{{ selectedFleet.type }}</div>
                  <div v-if="selectedFleet.set" class="tdp-fleet-set">{{ selectedFleet.set }}</div>
                </div>
                <div class="tdp-fleet-desc">{{ selectedFleet.meta.description }}</div>
              </template>
            </div>
            <button class="tdp-close" v-if="selectedFleet?.type !== 'VLocity'" @click="selectedVehicleId = null">✕</button>
          </div>

          <div v-if="selectedFleet" class="tdp-consist">
            <div class="tdp-section-label">Consist</div>
            <div class="tdp-consist-list">{{ selectedFleet.consist.join(' · ') }}</div>
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
    }))

    const d = new Date()
    lastUpdated.value = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (e) {
    error.value = e.message
    console.error('Fetch error:', e)
  } finally {
    loading.value = false
  }
}

watch(network, () => {
  vehicles.value = []
  refresh()
})

onMounted(() => {
  refresh()
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
</style>
