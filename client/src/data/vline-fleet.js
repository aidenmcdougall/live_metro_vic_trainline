// V/Line VLocity fleet knowledge base

export const VLOCITY_META = {
  manufacturer: 'Bombardier Transportation',
  introduced: 2005,
  cars: 3,
  description: 'VLocity DMU, built 2005–present',
}

const VLOCITY_SETS = []

// Series 1: 3VL/3VR/3VS 0–99 (car numbers 11XX, 13XX or 15XX, 12XX)
for (let i = 0; i <= 99; i++) {
  let setName, car2
  if (i >= 93 && i <= 98) {
    setName = `3VS${i}`
    car2 = 1500 + i  // Standard-gauge variant uses 15XX middle car
  } else {
    setName = i >= 76 && i <= 79 ? `3VR${i}` : `3VL${i}`
    car2 = 1300 + i
  }
  VLOCITY_SETS.push({ set: setName, consist: [1100 + i, car2, 1200 + i] })
}

// Series 2: 3VL100–141 (car numbers 2100–2141, 2300–2341, 2200–2241)
for (let i = 100; i <= 141; i++) {
  VLOCITY_SETS.push({ set: `3VL${i}`, consist: [2000 + i, 2200 + i, 2100 + i] })
}

// Flat lookup: car number string → set entry
// Series 1 cars (4-digit, leading 1) are also indexed as 3-digit since the
// API sometimes reports them as V117 rather than V1117
const VLOCITY_LOOKUP = {}
for (const entry of VLOCITY_SETS) {
  for (const car of entry.consist) {
    const s = String(car)
    VLOCITY_LOOKUP[s] = entry
    if (s.length === 4 && s.startsWith('1')) {
      VLOCITY_LOOKUP[s.slice(1)] = entry
    }
  }
}

export function getVLineFleetInfo(vehicleId) {
  if (!vehicleId) return null
  const carNum = vehicleId.startsWith('V') ? vehicleId.slice(1) : vehicleId
  const entry = VLOCITY_LOOKUP[carNum]
  if (!entry) return null
  return {
    type: 'VLocity',
    set: entry.set,
    consist: entry.consist.map(c => `V${c}`),
    meta: VLOCITY_META,
  }
}
