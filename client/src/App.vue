<template>
  <div class="app-shell">
    <Toolbar class="app-toolbar">
      <template #start>
        <span class="app-title">🚆 V/Line Live Tracker</span>
      </template>
      <template #end>
        <div class="toolbar-end">
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
      <TrainMap :vehicles="vehicles" />
      <ProgressBar v-if="loading && vehicles.length === 0" mode="indeterminate" class="loading-bar" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Toolbar from 'primevue/toolbar'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import TrainMap from './components/TrainMap.vue'

const vehicles = ref([])
const loading = ref(false)
const error = ref(null)
const lastUpdated = ref(null)

let pollInterval = null

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/vehicles')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    vehicles.value = data.vehicles
    const d = new Date()
    lastUpdated.value = d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (e) {
    error.value = e.message
    console.error('Fetch error:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refresh()
  // API has a 30s cache; poll every 30s
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
</style>
