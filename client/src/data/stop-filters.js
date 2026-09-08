// Rail stops in the source data include duplicate per-platform entries (plain numeric IDs) alongside
// one canonical per-station row (id "vic:rail:XXX"); station-level amenities like entrances or park &
// ride bays use a suffixed id ("vic:rail:XXX_EN1") and are excluded too. Matching on id, rather than a
// "Railway Station" name suffix, avoids missing stations whose name lacks that exact suffix or has
// formatting quirks (trailing spaces, parentheticals).
// Trams have no such id convention, so every tram stop is shown as-is.
const CANONICAL_RAIL_STOP_ID = /^vic:rail:[A-Za-z0-9]+$/

export function isDisplayStop(stop, network) {
  return network === 'tram' || CANONICAL_RAIL_STOP_ID.test(stop.id)
}
