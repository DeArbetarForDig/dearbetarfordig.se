/**
 * Innevarande mandatperiod: fullmäktige tillträder 15 oktober valåret (2022,
 * 2026, 2030 …) och sitter fyra år (kommunallagen 5 kap. 7 §).
 */
export function mandatperiod(nu = new Date()) {
  const år = nu.getUTCFullYear()
  let start = år - ((år - 2022) % 4)
  if (nu.getTime() < Date.UTC(start, 9, 15)) start -= 4
  const från = Date.UTC(start, 9, 15)
  const till = Date.UTC(start + 4, 9, 15)
  return {
    label: `${start}–${start + 4}`,
    procent: ((nu.getTime() - från) / (till - från)) * 100,
  }
}
