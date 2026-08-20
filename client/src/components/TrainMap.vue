<template>
  <div ref="mapEl" class="train-map" />
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getVehicleColor } from '../data/route-colors.js'
import { isDisplayStop } from '../data/stop-filters.js'
const props = defineProps({
  vehicles: {
    type: Array,
    default: () => [],
  },
  stops: {
    type: Array,
    default: () => [],
  },
  color: {
    type: String,
    default: '#a855f7',
  },
  network: {
    type: String,
    default: 'vline',
  },
  selectedId: {
    type: String,
    default: null,
  },
  routePolyline: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['train-selected', 'stop-selected'])

const mapEl = ref(null)
let map = null
const markerMap = {}
let stopsLayer = null
let routePastLine = null
let routeFutureLine = null
const STOPS_MIN_ZOOM = 11

function stopIcon() {
  return L.divIcon({
    className: '',
    html: '<span class="stop-pin">🚉</span>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

function syncStops(stops) {
  if (!stopsLayer) return
  stopsLayer.clearLayers()
  const filtered = stops.filter(s => isDisplayStop(s, props.network))
  for (const stop of filtered) {
    L.marker([stop.lat, stop.lng], { icon: stopIcon(), zIndexOffset: -500 })
      .bindTooltip(stop.name, { direction: 'top', offset: [0, -8], className: 'stop-tooltip' })
      .on('click', (e) => { L.DomEvent.stopPropagation(e); emit('stop-selected', stop.id) })
      .addTo(stopsLayer)
  }
  updateStopsVisibility()
}

function syncRouteLine(polyline) {
  if (routePastLine)   { routePastLine.remove();   routePastLine = null }
  if (routeFutureLine) { routeFutureLine.remove(); routeFutureLine = null }
  if (!polyline || !map) return
  if (polyline.past.length >= 2) {
    routePastLine = L.polyline(polyline.past, {
      color: '#ffffff', opacity: 0.2, weight: 2, interactive: false,
    }).addTo(map)
  }
  if (polyline.future.length >= 2) {
    routeFutureLine = L.polyline(polyline.future, {
      color: '#ffffff', opacity: 0.75, weight: 2, interactive: false,
    }).addTo(map)
  }
}

function updateStopsVisibility() {
  if (!map || !stopsLayer) return
  const zoom = map.getZoom()
  if (zoom >= STOPS_MIN_ZOOM) {
    if (!map.hasLayer(stopsLayer)) stopsLayer.addTo(map)
  } else {
    if (map.hasLayer(stopsLayer)) stopsLayer.remove()
  }
}

function vehicleColor(v) {
  return getVehicleColor(props.network, v.routeId, props.color)
}

const NETWORK_VIEWS = {
  vline: { center: [-37.69214941267092, 144.95849150482715], zoom: 9 },
  metro: { center: [-37.86044296365716, 144.9438085965693],  zoom: 11 },
  tram:  { center: [-37.82301718075124, 144.97199896419994], zoom: 12 },
}

const INITIAL_ZOOM = NETWORK_VIEWS.vline.zoom

function trainIcon(bearing, carriages = 3, color = props.color, delay = null, cancelled = false) {
  const rotation = (bearing ?? 0) - 90
  const zoom = map?.getZoom() ?? INITIAL_ZOOM

  const scale = Math.pow(2, (zoom - 13) / 4)
  const carW    = Math.max(2, Math.round(5 * scale))
  const carH    = Math.max(1, Math.round(2 * scale))
  const gap     = Math.max(1, Math.round(1 * scale))
  const arrowW  = Math.max(2, Math.round(carH * 0.4))
  const arrowGap = Math.max(1, Math.round(gap * 0.5))

  const carriagesW = carriages * carW + (carriages - 1) * gap
  const totalW = carriagesW + arrowGap + arrowW

  const box = Math.ceil(Math.sqrt(totalW * totalW + carH * carH)) + 2
  const ox = (box - totalW) / 2
  const oy = (box - carH) / 2

  const fillColor = cancelled ? '#6b7280' : color
  const rects = Array.from({ length: carriages }, (_, i) => {
    const x = ox + i * (carW + gap)
    return `<rect x="${x}" y="${oy}" width="${carW}" height="${carH}" rx="${Math.max(1, carH * 0.25)}" fill="${fillColor}"/>`
  }).join('')

  const ax = ox + carriagesW + arrowGap
  const arrow = `<polygon points="${ax},${oy} ${ax},${oy + carH} ${ax + arrowW},${oy + carH / 2}" fill="${fillColor}"/>`

  return L.divIcon({
    className: '',
    html: `<div style="opacity:${cancelled ? 0.5 : 1}">
             <svg xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 ${box} ${box}"
                  width="${box}" height="${box}"
                  style="display:block;transform:rotate(${rotation}deg);transform-origin:${box/2}px ${box/2}px;filter:drop-shadow(0 0 3px ${fillColor});">
               ${rects}${arrow}
             </svg>
           </div>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    popupAnchor: [0, -(box / 2 + 4)],
  })
}



function idPopupHtml(vehicleId) {
  return `<div class="train-id-popup">${vehicleId ?? '—'}</div>`
}

function syncMarkers(vehicles) {
  const incoming = new Set(vehicles.map(v => v.id))

  for (const id of Object.keys(markerMap)) {
    if (!incoming.has(id)) {
      markerMap[id].remove()
      delete markerMap[id]
    }
  }

  for (const v of vehicles) {
    const carriages = props.network === 'metro' ? 6 : props.network === 'tram' ? 1 : (v.tripId?.includes('BDE') ? 6 : 3)
    const color = vehicleColor(v)
    const icon = trainIcon(v.bearing, carriages, color, v.delay, v.cancelled)
    if (markerMap[v.id]) {
      markerMap[v.id].setLatLng([v.lat, v.lng])
      markerMap[v.id].setIcon(icon)
      markerMap[v.id].setPopupContent(idPopupHtml(v.vehicleId))
    } else {
      markerMap[v.id] = L.marker([v.lat, v.lng], { icon })
        .bindPopup(idPopupHtml(v.vehicleId), { autoPan: false, closeButton: false })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); emit('train-selected', v.id) })
        .addTo(map)
    }
  }

  // Re-open popup for selected marker in case setIcon closed it
  if (props.selectedId && markerMap[props.selectedId]) {
    markerMap[props.selectedId].openPopup()
  }
}

function focusVehicle(vehicleId) {
  const marker = markerMap[vehicleId]
  if (!marker) return
  const targetZoom = Math.max(map.getZoom(), 14)
  map.flyTo(marker.getLatLng(), targetZoom, { animate: true, duration: 1 })
  setTimeout(() => emit('train-selected', vehicleId), 1100)
}

function focusStop(lat, lng) {
  const targetZoom = Math.max(map.getZoom(), 15)
  map?.flyTo([lat, lng], targetZoom, { animate: true, duration: 1 })
}

defineExpose({ focusVehicle, focusStop })

watch(() => props.vehicles, syncMarkers)
watch(() => props.color, () => syncMarkers(props.vehicles))
watch(() => props.stops, syncStops)
watch(() => props.routePolyline, syncRouteLine)
watch(() => props.selectedId, (newId, oldId) => {
  if (oldId && markerMap[oldId]) markerMap[oldId].closePopup()
  if (newId && markerMap[newId]) markerMap[newId].openPopup()
})
watch(() => props.network, (n) => {
  const { center, zoom } = NETWORK_VIEWS[n] ?? NETWORK_VIEWS.vline
  map?.flyTo(center, zoom, { animate: true, duration: 1.2 })
})

onMounted(() => {
  const initView = NETWORK_VIEWS[props.network] ?? NETWORK_VIEWS.vline
  map = L.map(mapEl.value, {
    center: initView.center,
    zoom: initView.zoom,
    zoomControl: false,
  })
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  map.on('zoomend', () => { syncMarkers(props.vehicles); updateStopsVisibility() })
  map.on('click', () => emit('train-selected', null))

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map)

  stopsLayer = L.layerGroup()
  if (props.stops.length) syncStops(props.stops)
  if (props.vehicles.length) syncMarkers(props.vehicles)
})

onUnmounted(() => {
  map?.remove()
  map = null
  stopsLayer = null
  routePastLine = null
  routeFutureLine = null
})
</script>

<style>
.train-map {
  height: 100%;
  width: 100%;
  background: #1a1a2e;
}

/* Leaflet controls */
.leaflet-control-zoom a {
  background: #1a1a1a !important;
  color: #e2e8f0 !important;
  border-color: #333 !important;
}

.leaflet-control-zoom a:hover {
  background: #2a2a2a !important;
}

.leaflet-control-attribution {
  background: rgba(15, 15, 15, 0.8) !important;
  color: #6b7280 !important;
}

.leaflet-control-attribution a {
  color: #9ca3af !important;
}

/* Selected train ID popup */
.leaflet-popup-content-wrapper {
  background: rgba(10, 10, 16, 0.92) !important;
  border: 1px solid rgba(255,255,255,0.12) !important;
  box-shadow: 0 2px 16px rgba(0,0,0,0.6) !important;
  border-radius: 6px !important;
  padding: 0 !important;
}

.leaflet-popup-content {
  margin: 0 !important;
}

.leaflet-popup-tip-container {
  display: none;
}

/* Custom arrow — ::before draws the border, ::after fills over it */
.leaflet-popup-content-wrapper {
  position: relative;
  overflow: visible !important;
}

.leaflet-popup-content-wrapper::before {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid rgba(255,255,255,0.18);
}

.leaflet-popup-content-wrapper::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid rgba(10, 10, 16, 0.92);
}

.train-id-popup {
  font-size: 0.78rem;
  font-weight: 700;
  color: #f1f5f9;
  padding: 5px 10px;
  white-space: nowrap;
}

.leaflet-popup-close-button {
  display: none !important;
}

/* Station stop pins */
.stop-pin {
  font-size: 13px;
  line-height: 1;
  display: block;
  text-align: center;
  cursor: default;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.8));
}

.stop-tooltip {
  background: rgba(10, 10, 16, 0.92) !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  color: #e2e8f0 !important;
  font-size: 0.7rem !important;
  font-weight: 600 !important;
  padding: 3px 8px !important;
  border-radius: 4px !important;
  box-shadow: 0 2px 10px rgba(0,0,0,0.6) !important;
  white-space: nowrap !important;
}

.stop-tooltip.leaflet-tooltip-top::before {
  border-top-color: rgba(255,255,255,0.1) !important;
}
</style>
