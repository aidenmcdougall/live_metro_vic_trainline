<template>
  <div class="app-shell">
    <Toolbar class="app-toolbar">
      <template #start>
        <span class="app-title">🚆 Live Train Tracker</span>
      </template>
      <template #end>
        <div class="toolbar-end">
          <AutoComplete
            v-model="searchQuery"
            :suggestions="searchResults"
            option-label="label"
            placeholder="Search vehicle or route…"
            class="vehicle-search"
            @complete="searchVehicles"
            @item-select="onSearchSelect"
          />
          <SelectButton
            v-model="network"
            :options="networkOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
          <Button
            icon="pi pi-star-fill"
            :severity="hasFavourites ? 'warn' : 'secondary'"
            text
            rounded
            aria-label="Pinned & recent stations"
            @click="toggleFavouritesPopover"
          />
          <Popover ref="favouritesPopoverRef">
            <div class="fav-popover">
              <div class="fav-section">
                <div class="fav-section__title fav-section__title--row">
                  <span>Nearby</span>
                  <button
                    v-if="userLocation"
                    class="fav-relocate"
                    :disabled="locating"
                    title="Refresh location"
                    @click="useMyLocation"
                  >↻</button>
                </div>
                <div v-if="locationError" class="fav-empty">{{ locationError }}</div>
                <button v-else-if="!userLocation" class="fav-locate-btn" :disabled="locating" @click="useMyLocation">
                  {{ locating ? 'Locating…' : '📍 Use my location' }}
                </button>
                <template v-else>
                  <div v-for="s in nearbyStops" :key="'n:' + stopKey(s)" class="fav-item">
                    <span class="fav-item__link" @click="goToFavourite(s)">
                      <span class="fav-item__label">{{ s.name }}</span>
                      <span class="fav-item__net">{{ formatDistance(s.distanceMeters) }}</span>
                    </span>
                    <button class="fav-item__pin" :class="{ 'fav-item__pin--active': isStopPinned(s) }" @click="togglePinStop(s)" aria-label="Pin">★</button>
                  </div>
                  <div v-if="!nearbyStops.length" class="fav-empty">No stations found nearby.</div>
                </template>
              </div>
              <div class="fav-section" v-if="pinnedStops.length">
                <div class="fav-section__title">Pinned</div>
                <div v-for="s in pinnedStops" :key="'p:' + stopKey(s)" class="fav-item">
                  <span class="fav-item__link" @click="goToFavourite(s)">
                    <span class="fav-item__label">{{ s.name }}</span>
                    <span v-if="s.network !== network" class="fav-item__net">{{ s.network }}</span>
                  </span>
                  <button class="fav-item__pin fav-item__pin--active" @click="togglePinStop(s)" aria-label="Unpin">★</button>
                </div>
              </div>
              <div class="fav-section" v-if="recentStopsForDisplay.length">
                <div class="fav-section__title">Recent</div>
                <div v-for="s in recentStopsForDisplay" :key="'r:' + stopKey(s)" class="fav-item">
                  <span class="fav-item__link" @click="goToFavourite(s)">
                    <span class="fav-item__label">{{ s.name }}</span>
                    <span v-if="s.network !== network" class="fav-item__net">{{ s.network }}</span>
                  </span>
                  <button class="fav-item__pin" @click="togglePinStop(s)" aria-label="Pin">★</button>
                </div>
              </div>
              <div class="fav-empty" v-if="!pinnedStops.length && !recentStopsForDisplay.length">
                No pinned or recent stations yet — search or tap a station to add one.
              </div>
            </div>
          </Popover>
          <Tag
            v-if="!error"
            :value="`${vehicles.length} ${vehicleNoun}`"
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
      <TrainMap ref="trainMapRef" :vehicles="vehicles" :stops="stops" :color="networkColor" :network="network" :selected-id="selectedVehicleId" :route-polyline="routePolyline" @train-selected="onTrainSelected" @stop-selected="onStopSelected" />
      <ProgressBar v-if="loading && vehicles.length === 0" mode="indeterminate" class="loading-bar" />

      <div class="top-right-stack">
        <div class="alerts-panel" :class="{ 'alerts-panel--collapsed': alertsPanelCollapsed }" v-if="sortedAlerts.length">
          <div class="delay-panel__title" @click="alertsPanelCollapsed = !alertsPanelCollapsed">
            <span class="delay-panel__title-text">
              <span v-if="alertsPanelCollapsed">🛈</span>
              <span v-else>Service Alerts</span>
            </span>
            <span class="delay-panel__count" v-if="alertsPanelCollapsed">{{ sortedAlerts.length }}</span>
            <span class="delay-panel__toggle" :class="{ 'delay-panel__toggle--open': !alertsPanelCollapsed }">›</span>
          </div>
          <div class="delay-panel__list" v-show="!alertsPanelCollapsed">
            <div
              v-for="a in sortedAlerts"
              :key="a.id"
              class="alert-row"
              @click="toggleAlert(a.id)"
            >
              <div class="alert-row__top">
                <span class="alert-badge" :class="effectClass(a.effect)">{{ effectLabel(a.effect) }}</span>
                <span class="alert-row__header">{{ a.header }}</span>
              </div>
              <div v-if="expandedAlerts.has(a.id)" class="alert-row__desc">
                {{ a.description }}
                <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="alert-row__link" @click.stop>More info →</a>
              </div>
            </div>
          </div>
        </div>

        <div class="delay-panel" :class="{ 'delay-panel--collapsed': delayPanelCollapsed }" v-if="delayedVehicles.length">
          <div class="delay-panel__title" @click="delayPanelCollapsed = !delayPanelCollapsed">
            <span class="delay-panel__title-text">
              <span v-if="delayPanelCollapsed">⚠</span>
              <span v-else>Delays</span>
            </span>
            <span class="delay-panel__count" v-if="delayPanelCollapsed">{{ delayedVehicles.length }}</span>
            <span class="delay-panel__toggle" :class="{ 'delay-panel__toggle--open': !delayPanelCollapsed }">›</span>
          </div>
          <div class="delay-panel__list" v-show="!delayPanelCollapsed">
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
      </div>

      <!-- Right detail panel -->
      <Transition name="panel-slide">
        <div v-if="selectedVehicle" class="train-detail-panel" :style="{ '--net-color': selectedVehicleColor }">
          <div class="tdp-image-wrap" v-if="fleetImageSrc">
            <img :src="fleetImageSrc" :alt="selectedFleet?.type" class="tdp-image" />
            <button class="tdp-close tdp-close--on-image" @click="selectedVehicleId = null">✕</button>
            <div v-if="fleetAttribution" class="tdp-image-credit">
              © <a :href="fleetAttribution.authorUrl" target="_blank" rel="noopener">{{ fleetAttribution.author }}</a>
              · <a :href="fleetAttribution.licenseUrl" target="_blank" rel="noopener">{{ fleetAttribution.license }}</a>
              · <a :href="fleetAttribution.sourceUrl" target="_blank" rel="noopener">Wikimedia</a>
            </div>
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

          <div v-if="selectedVehicleAlerts.length" class="tdp-alerts">
            <div class="tdp-section-label" style="padding: 12px 14px 6px">Alerts</div>
            <div
              v-for="a in selectedVehicleAlerts"
              :key="a.id"
              class="alert-row alert-row--panel"
              @click="toggleAlert(a.id)"
            >
              <div class="alert-row__top">
                <span class="alert-badge" :class="effectClass(a.effect)">{{ effectLabel(a.effect) }}</span>
                <span class="alert-row__header">{{ a.header }}</span>
              </div>
              <div v-if="expandedAlerts.has(a.id)" class="alert-row__desc">
                {{ a.description }}
                <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="alert-row__link" @click.stop>More info →</a>
              </div>
            </div>
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

      <!-- Station departure board -->
      <Transition name="panel-slide">
        <div v-if="selectedStop" class="train-detail-panel">
          <div class="tdp-header">
            <div class="tdp-header-main">
              <div class="tdp-vehicle-id">{{ selectedStop.name }}</div>
              <div class="tdp-headsign">Next departures</div>
            </div>
            <button
              class="tdp-pin"
              :class="{ 'tdp-pin--active': isStopPinned(selectedStop) }"
              @click="togglePinStop(selectedStop)"
              :aria-label="isStopPinned(selectedStop) ? 'Unpin station' : 'Pin station'"
            >★</button>
            <button class="tdp-close" @click="selectedStopId = null">✕</button>
          </div>

          <div v-if="selectedStopAlerts.length" class="tdp-alerts">
            <div class="tdp-section-label" style="padding: 12px 14px 6px">Alerts</div>
            <div
              v-for="a in selectedStopAlerts"
              :key="a.id"
              class="alert-row alert-row--panel"
              @click="toggleAlert(a.id)"
            >
              <div class="alert-row__top">
                <span class="alert-badge" :class="effectClass(a.effect)">{{ effectLabel(a.effect) }}</span>
                <span class="alert-row__header">{{ a.header }}</span>
              </div>
              <div v-if="expandedAlerts.has(a.id)" class="alert-row__desc">
                {{ a.description }}
                <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="alert-row__link" @click.stop>More info →</a>
              </div>
            </div>
          </div>

          <div v-if="stopDepartures.loading && !stopDepartures.departures.length" class="tdp-tl-loading">
            Loading departures...
          </div>
          <div v-if="!stopDepartures.loading && !stopDepartures.departures.length" class="tdp-tl-loading">
            No upcoming departures found.
          </div>

          <div class="tdp-fields" v-if="stopDepartures.departures.length">
            <div
              v-for="d in stopDepartures.departures"
              :key="d.tripId"
              class="tdp-row tdp-departure-row"
              :class="{ 'delay-row--cancelled': d.cancelled }"
            >
              <span class="tdp-key tdp-departure-route">
                <span class="tdp-departure-badge" :style="{ background: getVehicleColor(network, d.routeId, networkColor) }">{{ routeCode(d.routeId) }}</span>
                Towards {{ d.headsign }}
              </span>
              <span class="tdp-val">
                <template v-if="d.cancelled">CANC</template>
                <template v-else>
                  {{ formatJourneyTime(d.estTime ?? d.schedTime) }}
                  <span v-if="d.delayMins" :class="d.delayMins > 0 ? 'tdp-tl-delay tdp-tl-delay--late' : 'tdp-tl-delay tdp-tl-delay--early'">
                    {{ d.delayMins > 0 ? '+' + d.delayMins + 'm' : d.delayMins + 'm' }}
                  </span>
                </template>
              </span>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <div v-if="updateAvailable" class="pwa-toast">
      <span>New version available</span>
      <button class="pwa-toast__btn" @click="applyUpdate">Reload</button>
    </div>
    <div v-else-if="offlineReady" class="pwa-toast pwa-toast--info">
      App ready to work offline
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
import AutoComplete from 'primevue/autocomplete'
import Popover from 'primevue/popover'
import { registerSW } from 'virtual:pwa-register'
import TrainMap from './components/TrainMap.vue'
import { getFleetInfo } from './data/metro-fleet.js'
import { getVLineFleetInfo } from './data/vline-fleet.js'
import { NETWORK_COLORS, getVehicleColor } from './data/route-colors.js'
import { isDisplayStop } from './data/stop-filters.js'

const networkOptions = [
  { label: 'V/Line', value: 'vline' },
  { label: 'Metro',  value: 'metro' },
  { label: 'Tram',   value: 'tram' },
]

const trainMapRef = ref(null)
const favouritesPopoverRef = ref(null)
const network = ref('vline')

const updateAvailable = ref(false)
const offlineReady = ref(false)
const updateSW = registerSW({
  onNeedRefresh() { updateAvailable.value = true },
  onOfflineReady() {
    offlineReady.value = true
    setTimeout(() => { offlineReady.value = false }, 4000)
  },
})

function applyUpdate() {
  updateSW(true)
}

function toggleFavouritesPopover(event) {
  favouritesPopoverRef.value?.toggle(event)
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const PINNED_STOPS_KEY = 'trainTracker.pinnedStops.v1'
const RECENT_STOPS_KEY = 'trainTracker.recentStops.v1'
const RECENT_STOPS_MAX = 8

const pinnedStops = ref(loadJSON(PINNED_STOPS_KEY, []))
const recentStops = ref(loadJSON(RECENT_STOPS_KEY, []))

watch(pinnedStops, (v) => localStorage.setItem(PINNED_STOPS_KEY, JSON.stringify(v)), { deep: true })
watch(recentStops, (v) => localStorage.setItem(RECENT_STOPS_KEY, JSON.stringify(v)), { deep: true })

const hasFavourites = computed(() => pinnedStops.value.length > 0)

function stopKey(s) {
  return `${s.network}:${s.id}`
}

function isStopPinned(stop) {
  if (!stop) return false
  return pinnedStops.value.some(s => s.id === stop.id && s.network === network.value)
}

function togglePinStop(stop) {
  if (!stop) return
  const idx = pinnedStops.value.findIndex(s => s.id === stop.id && s.network === (stop.network ?? network.value))
  if (idx >= 0) {
    pinnedStops.value = pinnedStops.value.filter((_, i) => i !== idx)
  } else {
    pinnedStops.value = [{ id: stop.id, name: stop.name, network: stop.network ?? network.value }, ...pinnedStops.value]
  }
}

function recordRecentStop(stop) {
  const filtered = recentStops.value.filter(s => !(s.id === stop.id && s.network === network.value))
  recentStops.value = [{ id: stop.id, name: stop.name, network: network.value }, ...filtered].slice(0, RECENT_STOPS_MAX)
}

const recentStopsForDisplay = computed(() =>
  recentStops.value.filter(r => !pinnedStops.value.some(p => p.id === r.id && p.network === r.network))
)

const userLocation = ref(null)
const locating = ref(false)
const locationError = ref(null)

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`
}

function useMyLocation() {
  if (!navigator.geolocation) { locationError.value = 'Geolocation not supported'; return }
  locating.value = true
  locationError.value = null
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      locating.value = false
    },
    (err) => {
      locationError.value = err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Could not get location'
      locating.value = false
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  )
}

const nearbyStops = computed(() => {
  if (!userLocation.value) return []
  return stops.value
    .filter(s => isDisplayStop(s, network.value))
    .map(s => ({
      id: s.id,
      name: s.name,
      network: network.value,
      distanceMeters: haversineMeters(userLocation.value.lat, userLocation.value.lng, s.lat, s.lng),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 3)
})

async function goToFavourite(item) {
  favouritesPopoverRef.value?.hide()
  if (network.value !== item.network) {
    network.value = item.network
    await new Promise(resolve => {
      const timeout = setTimeout(() => { unwatch(); resolve() }, 4000)
      const unwatch = watch(stops, (list) => {
        if (list.some(s => s.id === item.id)) { clearTimeout(timeout); unwatch(); resolve() }
      })
    })
  }
  onStopSelected(item.id)
  const coords = stopCoordsMap.value[item.id]
  if (coords) trainMapRef.value?.focusStop(coords.lat, coords.lng)
}
const networkColor = computed(() => NETWORK_COLORS[network.value])
const vehicleNoun = computed(() => network.value === 'tram' ? 'trams' : 'trains')

const selectedVehicleColor = computed(() => {
  if (!selectedVehicle.value?.routeId) return networkColor.value
  return getVehicleColor(network.value, selectedVehicle.value.routeId, networkColor.value)
})

function routeCode(routeId) {
  return routeId?.split('-').pop()?.replace(/:/g, '') ?? '—'
}

const searchQuery = ref('')
const searchResults = ref([])

function searchVehicles(event) {
  const q = event.query.trim().toLowerCase()
  if (!q) { searchResults.value = []; return }
  const vehicleMatches = vehicles.value
    .filter(v => v.vehicleId?.toLowerCase().includes(q) || routeCode(v.routeId).toLowerCase().includes(q))
    .slice(0, 10)
    .map(v => ({ kind: 'vehicle', id: v.id, label: `🚋 ${v.vehicleId ?? v.id} · Route ${routeCode(v.routeId)}` }))
  const stopMatches = stops.value
    .filter(s => isDisplayStop(s, network.value) && s.name?.toLowerCase().includes(q))
    .slice(0, 10)
    .map(s => ({ kind: 'stop', id: s.id, label: `🚉 ${s.name}` }))
  searchResults.value = [...vehicleMatches, ...stopMatches].slice(0, 15)
}

function onSearchSelect(event) {
  const item = event.value
  if (item.kind === 'stop') {
    onStopSelected(item.id)
    const coords = stopCoordsMap.value[item.id]
    if (coords) trainMapRef.value?.focusStop(coords.lat, coords.lng)
  } else {
    trainMapRef.value?.focusVehicle(item.id)
  }
  searchQuery.value = ''
  searchResults.value = []
}

const serviceAlerts = ref([])
const alertsPanelCollapsed = ref(false)
const expandedAlerts = ref(new Set())

function toggleAlert(id) {
  const next = new Set(expandedAlerts.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedAlerts.value = next
}

const ALERT_SEVERITY_ORDER = {
  NO_SERVICE: 0, SIGNIFICANT_DELAYS: 1, REDUCED_SERVICE: 2, DETOUR: 3,
  STOP_MOVED: 4, MODIFIED_SERVICE: 5, ACCESSIBILITY_ISSUE: 6,
  ADDITIONAL_SERVICE: 7, OTHER_EFFECT: 8, UNKNOWN_EFFECT: 9, NO_EFFECT: 10,
}

const sortedAlerts = computed(() =>
  [...serviceAlerts.value].sort((a, b) =>
    (ALERT_SEVERITY_ORDER[a.effect] ?? 99) - (ALERT_SEVERITY_ORDER[b.effect] ?? 99)
  )
)

const ALERT_EFFECT_LABELS = {
  NO_SERVICE: 'No service', REDUCED_SERVICE: 'Reduced service', SIGNIFICANT_DELAYS: 'Delays',
  DETOUR: 'Diversion', ADDITIONAL_SERVICE: 'Extra service', MODIFIED_SERVICE: 'Service change',
  STOP_MOVED: 'Stop moved', ACCESSIBILITY_ISSUE: 'Accessibility',
}

function effectLabel(effect) {
  return ALERT_EFFECT_LABELS[effect] ?? 'Notice'
}

function effectClass(effect) {
  if (effect === 'NO_SERVICE' || effect === 'SIGNIFICANT_DELAYS') return 'alert-badge--severe'
  if (['REDUCED_SERVICE', 'DETOUR', 'STOP_MOVED', 'MODIFIED_SERVICE'].includes(effect)) return 'alert-badge--warn'
  return 'alert-badge--info'
}

function alertsForRoute(routeId) {
  if (!routeId) return []
  return serviceAlerts.value.filter(a => a.informed.some(ie => ie.routeId === routeId))
}

function alertsForStop(stopId) {
  if (!stopId) return []
  return serviceAlerts.value.filter(a => a.informed.some(ie => ie.stopIds?.includes(stopId)))
}

const selectedVehicleAlerts = computed(() => alertsForRoute(selectedVehicle.value?.routeId))
const selectedStopAlerts = computed(() => alertsForStop(selectedStopId.value))

async function fetchServiceAlerts() {
  try {
    const res = await fetch(`/api/service-alerts?network=${network.value}`)
    if (!res.ok) { serviceAlerts.value = []; return }
    const data = await res.json()
    serviceAlerts.value = data.alerts ?? []
  } catch (e) {
    console.warn('Service alerts fetch failed:', e.message)
    serviceAlerts.value = []
  }
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

const selectedStopId = ref(null)
const selectedStop = computed(() =>
  stops.value.find(s => s.id === selectedStopId.value) ?? null
)
const stopDepartures = ref({ departures: [], loading: false })

async function fetchStopDepartures(stopId) {
  if (!stopId) { stopDepartures.value = { departures: [], loading: false }; return }
  stopDepartures.value = { departures: stopDepartures.value.departures, loading: true }
  try {
    const res = await fetch(`/api/stop-departures?stopId=${encodeURIComponent(stopId)}&network=${network.value}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    stopDepartures.value = { departures: data.departures ?? [], loading: data.loading ?? false }
  } catch (e) {
    console.warn('Stop departures fetch failed:', e.message)
    stopDepartures.value = { departures: [], loading: false }
  }
}

function onStopSelected(id) {
  selectedStopId.value = id
  selectedVehicleId.value = null
  if (id) {
    const stop = stops.value.find(s => s.id === id)
    if (stop) recordRecentStop(stop)
  }
}

watch(selectedStopId, (id) => fetchStopDepartures(id))

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
  'VLocity':      '/VLocity.jpg',
  'N type':       '/NTrain.jpg',
  'Comeng':       '/Comeng.jpg',
  'Siemens':      '/Siemens.jpg',
  "X'Trapolis":   '/XTrapolis.jpg',
  'HCMT':         '/HCMT.jpg',
  "X'Trapolis 2": '/XTrapolis2.jpg',
}

const FLEET_ATTRIBUTION = {
  'VLocity':      { author: 'PEPSI697',      authorUrl: 'https://commons.wikimedia.org/wiki/User:PEPSI697',                              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=180749183' },
  'N type':       { author: 'Thomas Hobley', authorUrl: 'https://commons.wikimedia.org/w/index.php?title=User:ThomasH7532',              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=106624767' },
  'Comeng':       { author: 'Joel200716',    authorUrl: 'https://commons.wikimedia.org/w/index.php?title=User:Joel200716',               license: 'CC BY 4.0',    licenseUrl: 'https://creativecommons.org/licenses/by/4.0',    sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=148422496' },
  'Siemens':      { author: 'PEPSI697',      authorUrl: 'https://commons.wikimedia.org/wiki/User:PEPSI697',                              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=182724969' },
  "X'Trapolis":   { author: 'PEPSI697',      authorUrl: 'https://commons.wikimedia.org/wiki/User:PEPSI697',                              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=193709148' },
  'HCMT':         { author: 'PEPSI697',      authorUrl: 'https://commons.wikimedia.org/wiki/User:PEPSI697',                              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=182724971' },
  "X'Trapolis 2": { author: 'PEPSI697',      authorUrl: 'https://commons.wikimedia.org/wiki/User:PEPSI697',                              license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=193709147' },
}

const fleetImageSrc = computed(() => FLEET_IMAGES[selectedFleet.value?.type] ?? null)
const fleetAttribution = computed(() => FLEET_ATTRIBUTION[selectedFleet.value?.type] ?? null)

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
  selectedStopId.value = null
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
      color:  selectedVehicleColor.value,
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
  return { past, future, color: selectedVehicleColor.value }
})
const loading = ref(false)
const error = ref(null)
const lastUpdated = ref(null)
const delayPanelCollapsed = ref(false)

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
    if (selectedStopId.value) fetchStopDepartures(selectedStopId.value)
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
  serviceAlerts.value = []
  tripSchedule.value = { stops: [], loading: false, headsign: null }
  tripShape.value = null
  selectedVehicleId.value = null
  selectedStopId.value = null
  refresh()
  fetchStops()
  fetchServiceAlerts()
})

onMounted(() => {
  refresh()
  fetchStops()
  fetchServiceAlerts()
  pollInterval = setInterval(() => { refresh(); fetchServiceAlerts() }, 30_000)
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
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem 0.75rem;
}

.last-updated {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.vehicle-search input {
  width: 180px;
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

.top-right-stack {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-height: calc(100vh - 24px);
}

.alerts-panel,
.delay-panel {
  background: rgba(15, 15, 20, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  min-width: 160px;
  max-width: 320px;
  max-height: 45vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0 0;
}

.alerts-panel--collapsed,
.delay-panel--collapsed {
  min-width: unset;
  padding: 0;
}

.delay-panel__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  padding: 6px 10px 6px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 0;
  cursor: pointer;
  user-select: none;
}

.delay-panel--collapsed .delay-panel__title {
  border-bottom: none;
  padding: 7px 10px 7px 12px;
}

.delay-panel__title:hover {
  background: rgba(255,255,255,0.04);
  border-radius: 8px 8px 0 0;
}

.delay-panel--collapsed .delay-panel__title:hover {
  border-radius: 8px;
}

.delay-panel__title-text {
  flex: 1;
}

.delay-panel__count {
  font-size: 0.68rem;
  font-weight: 700;
  background: #92400e;
  color: #fbbf24;
  padding: 1px 5px;
  border-radius: 4px;
}

.delay-panel__toggle {
  color: #4b5563;
  font-size: 1.1rem;
  line-height: 1;
  display: inline-block;
  transform: rotate(0deg);
  transition: transform 0.2s ease;
}

.delay-panel__toggle--open {
  transform: rotate(90deg);
}

/* restore bottom padding on the list wrapper when expanded */
.delay-panel__list {
  padding-bottom: 4px;
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
  min-width: 0;
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
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
}

.delay-row__route {
  color: #6b7280;
  font-size: 0.72rem;
  white-space: nowrap;
  flex-shrink: 0;
}

.delay-row__sep {
  color: #374151;
  font-size: 0.72rem;
  flex-shrink: 0;
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

/* Service alerts */
.alert-row {
  padding: 6px 12px;
  font-size: 0.78rem;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.alert-row:last-child {
  border-bottom: none;
}

.alert-row:hover {
  background: rgba(255,255,255,0.05);
}

.alert-row__top {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.alert-row__header {
  color: #d1d5db;
  line-height: 1.35;
}

.alert-badge {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
}

.alert-badge--severe { background: #7f1d1d; color: #fca5a5; }
.alert-badge--warn   { background: #92400e; color: #fbbf24; }
.alert-badge--info   { background: #1e3a8a; color: #93c5fd; }

.alert-row__desc {
  margin-top: 5px;
  padding-right: 4px;
  font-size: 0.74rem;
  line-height: 1.5;
  color: #6b7280;
}

.alert-row__link {
  display: inline-block;
  margin-top: 4px;
  color: #93c5fd;
  text-decoration: none;
  font-size: 0.72rem;
}

.alert-row__link:hover {
  text-decoration: underline;
}

.tdp-alerts {
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding-bottom: 6px;
}

.alert-row--panel {
  padding: 6px 14px;
}

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

.tdp-image-credit {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 10px 6px;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  font-size: 0.6rem;
  color: rgba(255,255,255,0.55);
  line-height: 1.4;
}

.tdp-image-credit a {
  color: rgba(255,255,255,0.55);
  text-decoration: none;
}

.tdp-image-credit a:hover {
  color: rgba(255,255,255,0.9);
  text-decoration: underline;
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

.tdp-pin {
  flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  border: none;
  color: #6b7280;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  margin-top: 2px;
  margin-right: 6px;
}

.tdp-pin:hover {
  background: rgba(255,255,255,0.12);
  color: #e2e8f0;
}

.tdp-pin--active {
  color: #fbbf24;
}

/* Favourites popover */
.fav-popover {
  min-width: 220px;
  max-width: 280px;
}

.fav-section + .fav-section {
  margin-top: 10px;
}

.fav-section__title {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6b7280;
  margin-bottom: 4px;
}

.fav-section__title--row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fav-relocate {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  padding: 2px;
}

.fav-relocate:hover {
  color: #d1d5db;
}

.fav-locate-btn {
  width: 100%;
  background: rgba(255,255,255,0.05);
  border: 1px dashed rgba(255,255,255,0.15);
  border-radius: 6px;
  color: #9ca3af;
  font-family: inherit;
  font-size: 0.78rem;
  padding: 7px 10px;
  cursor: pointer;
  text-align: center;
}

.fav-locate-btn:hover {
  background: rgba(255,255,255,0.08);
  color: #e2e8f0;
}

.fav-locate-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

.fav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 2px;
  font-size: 0.82rem;
}

.fav-item__link {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  color: #d1d5db;
}

.fav-item__link:hover {
  color: #f1f5f9;
}

.fav-item__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-item__net {
  flex-shrink: 0;
  font-size: 0.65rem;
  text-transform: uppercase;
  color: #4b5563;
}

.fav-item__pin {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #374151;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 2px;
}

.fav-item__pin:hover {
  color: #9ca3af;
}

.fav-item__pin--active {
  color: #fbbf24;
}

.fav-empty {
  font-size: 0.78rem;
  color: #6b7280;
  font-style: italic;
  max-width: 200px;
  line-height: 1.5;
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

.tdp-departure-row {
  align-items: center;
}

.tdp-departure-route {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tdp-departure-badge {
  flex-shrink: 0;
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 700;
  color: #0a0a0f;
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 7px;
}

.tdp-departure-row.delay-row--cancelled .tdp-departure-route,
.tdp-departure-row.delay-row--cancelled .tdp-val {
  color: #9ca3af;
  text-decoration: line-through;
}

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

.pwa-toast {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(15, 15, 20, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.82rem;
  color: #d1d5db;
  box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  white-space: nowrap;
}

.pwa-toast--info {
  color: #9ca3af;
}

.pwa-toast__btn {
  background: #a855f7;
  border: none;
  color: #0a0a0f;
  font-weight: 700;
  font-size: 0.78rem;
  font-family: inherit;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.pwa-toast__btn:hover {
  background: #c084fc;
}

/* Mobile */
@media (max-width: 640px) {
  .app-toolbar {
    padding: 0.5rem 0.75rem;
  }

  .app-title {
    font-size: 0.95rem;
  }

  .toolbar-end {
    width: 100%;
    justify-content: flex-start;
  }

  .vehicle-search {
    flex: 1 1 auto;
    order: 1;
  }

  .vehicle-search input {
    width: 100%;
    min-width: 0;
  }

  .last-updated {
    display: none;
  }

  .top-right-stack {
    top: 8px;
    right: 8px;
    max-width: min(220px, 55vw);
  }

  .alerts-panel,
  .delay-panel {
    min-width: 0;
    max-width: min(220px, 55vw);
    font-size: 0.9em;
  }

  .train-detail-panel {
    top: 8px;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
  }

  .fav-popover {
    min-width: 0;
    max-width: min(260px, 80vw);
  }
}
</style>
