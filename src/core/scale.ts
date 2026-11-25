// Scale bar math (pure): a round length in km and its size in map units.

/** Largest 1, 2 or 5 × 10^n that is <= v (0 for non-positive or non-finite v). */
export function niceKm(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 0
  const p = 10 ** Math.floor(Math.log10(v))
  const m = [5, 2, 1].find((k) => k * p <= v * (1 + 1e-9)) ?? 1
  return Number((m * p).toPrecision(12)) // drop float noise like 0.30000000000000004
}

export const formatKm = (km: number) => `${km.toLocaleString('pt-BR')} km`

/** A scale bar about `maxUnits` long at most: round km, its length in map units, and its label. */
export function scaleBarSpec(kmPerUnit: number, maxUnits: number): { km: number; units: number; label: string } {
  const km = niceKm(maxUnits * kmPerUnit)
  return { km, units: km / kmPerUnit, label: formatKm(km) }
}
