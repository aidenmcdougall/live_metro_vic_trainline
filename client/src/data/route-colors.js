export const NETWORK_COLORS = {
  vline: '#a855f7',
  metro: '#3b82f6',
  tram: '#22c55e',
}

const METRO_ROUTE_COLORS = {
  WER: '#f472b6', LAV: '#f472b6', WIL: '#f472b6', SHM: '#f472b6',
  SUY: '#38bdf8', CBE: '#38bdf8', PKM: '#38bdf8',
  UFD: '#fbbf24', CGB: '#fbbf24',
  HBE: '#ef4444', MDD: '#ef4444',
  LIL: '#1d4ed8', BEG: '#1d4ed8', ALM: '#1d4ed8', GWY: '#1d4ed8',
  FKN: '#16a34a',
}

// Route 35 = City Circle, the heritage W-class tourist tram — every other tram stays network green
const TRAM_ROUTE_COLORS = {
  '35': '#6B3529',
}

export function getVehicleColor(network, routeId, fallbackColor) {
  const code = routeId?.split('-').pop()?.replace(/:/g, '')
  if (network === 'metro') return METRO_ROUTE_COLORS[code] ?? fallbackColor
  if (network === 'tram') return TRAM_ROUTE_COLORS[code] ?? fallbackColor
  return fallbackColor
}
