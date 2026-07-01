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
      <TrainMap :vehicles="vehicles" :color="networkColor" :network="network" />
      <ProgressBar v-if="loading && vehicles.length === 0" mode="indeterminate" class="loading-bar" />

      <div class="delay-panel" v-if="delayedVehicles.length">
        <div class="delay-panel__title">Delays</div>
        <div class="delay-panel__list">
          <div
            v-for="v in delayedVehicles"
            :key="v.id"
            class="delay-row"
            :class="{ 'delay-row--cancelled': v.cancelled }"
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

const networkOptions = [
  { label: 'V/Line', value: 'vline' },
  { label: 'Metro',  value: 'metro' },
]

const NETWORK_COLORS = {
  vline: '#a855f7',
  metro: '#3b82f6',
}

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

.delay-row:hover {
  background: rgba(255,255,255,0.04);
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
</style>
