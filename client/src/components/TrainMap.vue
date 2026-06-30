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
})

const mapEl = ref(null)
let map = null
const markerMap = {}

// Victoria bounds — map starts here
const VICTORIA_CENTER = [-37.69214941267092, 144.95849150482715]
const INITIAL_ZOOM = 9

function trainIcon(bearing, carriages = 3) {
  const rotation = (bearing ?? 0) + 90
  const zoom = map?.getZoom() ?? INITIAL_ZOOM

  // Scale so carriages are ~80px total at zoom 13, halving every 4 zoom levels
  const scale = Math.pow(2, (zoom - 13) / 4)
  const carW = Math.max(4, Math.round(19 * scale))
  const carH = Math.max(2, Math.round(8  * scale))
  const gap  = Math.max(1, Math.round(3  * scale))

  const totalW = carriages * carW + (carriages - 1) * gap
  const box = Math.ceil(Math.sqrt(totalW * totalW + carH * carH)) + 2
  const ox = (box - totalW) / 2
  const oy = (box - carH) / 2

  const rects = Array.from({ length: carriages }, (_, i) => {
    const x = ox + i * (carW + gap)
    return `<rect x="${x}" y="${oy}" width="${carW}" height="${carH}" rx="${Math.max(1, carH * 0.25)}" fill="#a855f7"/>`
  }).join('')

  return L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg"
               viewBox="0 0 ${box} ${box}"
               width="${box}" height="${box}"
               style="display:block;transform:rotate(${rotation}deg);transform-origin:${box/2}px ${box/2}px;">
             ${rects}
           </svg>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    popupAnchor: [0, -(box / 2 + 4)],
  })
}

function popupHtml(v) {
  const time = v.timestamp
    ? new Date(v.timestamp * 1000).toLocaleTimeString('en-AU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'
  return `
    <div class="train-popup">
      <strong>${v.label ?? v.id}</strong>
      <table>
        <tr><td>Route</td><td>${v.routeId ?? '—'}</td></tr>
        <tr><td>Trip</td><td>${v.tripId ?? '—'}</td></tr>
        <tr><td>Speed</td><td>${v.speed != null ? v.speed + ' km/h' : '—'}</td></tr>
        <tr><td>Bearing</td><td>${v.bearing != null ? v.bearing + '°' : '—'}</td></tr>
        <tr><td>Updated</td><td>${time}</td></tr>
      </table>
    </div>`
}

function syncMarkers(vehicles) {
  const incoming = new Set(vehicles.map(v => v.id))

  // Remove stale markers
  for (const id of Object.keys(markerMap)) {
    if (!incoming.has(id)) {
      markerMap[id].remove()
      delete markerMap[id]
    }
  }

  for (const v of vehicles) {
    const carriages = v.carriages ?? 3
    if (markerMap[v.id]) {
      markerMap[v.id].setLatLng([v.lat, v.lng])
      markerMap[v.id].setIcon(trainIcon(v.bearing, carriages))
      markerMap[v.id].setPopupContent(popupHtml(v))
    } else {
      markerMap[v.id] = L.marker([v.lat, v.lng], { icon: trainIcon(v.bearing, carriages) })
        .bindPopup(popupHtml(v))
        .addTo(map)
    }
  }
}

watch(() => props.vehicles, syncMarkers)

onMounted(() => {
  map = L.map(mapEl.value, {
    center: VICTORIA_CENTER,
    zoom: INITIAL_ZOOM,
    zoomControl: true,
  })

  map.on('zoomend', () => syncMarkers(props.vehicles))

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

/* Dark popup */
.leaflet-popup-content-wrapper {
  background: #1e2235;
  color: #e2e8f0;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}

.leaflet-popup-tip {
  background: #1e2235;
}

.train-popup strong {
  display: block;
  font-size: 1rem;
  margin-bottom: 6px;
}

.train-popup table {
  border-collapse: collapse;
  font-size: 0.82rem;
  width: 100%;
}

.train-popup td {
  padding: 2px 6px;
}

.train-popup td:first-child {
  color: #6b7280;
  white-space: nowrap;
}
</style>
