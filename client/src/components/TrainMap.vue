<template>
  <div ref="mapEl" class="train-map" />
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
const props = defineProps({
  vehicles: {
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
})

const emit = defineEmits(['train-selected'])

const mapEl = ref(null)
let map = null
const markerMap = {}

const METRO_ROUTE_COLORS = {
  WER: '#f472b6', LAV: '#f472b6', WIL: '#f472b6', SHM: '#f472b6',
  SUY: '#38bdf8', CBE: '#38bdf8', PKM: '#38bdf8',
  UFD: '#fbbf24', CGB: '#fbbf24',
  HBE: '#ef4444', MDD: '#ef4444',
  LIL: '#1d4ed8', BEG: '#1d4ed8', ALM: '#1d4ed8', GWY: '#1d4ed8',
  FKN: '#16a34a',
}

function vehicleColor(v) {
  if (props.network === 'metro') {
    const code = v.routeId?.split('-').pop()?.replace(/:/g, '')
    return METRO_ROUTE_COLORS[code] ?? props.color
  }
  return props.color
}

const NETWORK_VIEWS = {
  vline: { center: [-37.69214941267092, 144.95849150482715], zoom: 9 },
  metro: { center: [-37.86044296365716, 144.9438085965693],  zoom: 11 },
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
    const carriages = props.network === 'metro' ? 6 : (v.tripId?.includes('BDE') ? 6 : 3)
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

defineExpose({ focusVehicle })

watch(() => props.vehicles, syncMarkers)
watch(() => props.color, () => syncMarkers(props.vehicles))
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

  map.on('zoomend', () => syncMarkers(props.vehicles))
  map.on('click', () => emit('train-selected', null))

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map)

  if (props.vehicles.length) syncMarkers(props.vehicles)
})

onUnmounted(() => {
  map?.remove()
  map = null
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
</style>
