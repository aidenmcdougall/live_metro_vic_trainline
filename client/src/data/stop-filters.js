// Rail stop names in the source data include duplicate per-platform entries and rail-replacement
// bus stops alongside the canonical station; "Railway Station" reliably names just the canonical one.
// Trams have no such suffix convention, so every tram stop is shown as-is.
export function isDisplayStop(stop, network) {
  return network === 'tram' || stop.name?.endsWith('Railway Station')
}
