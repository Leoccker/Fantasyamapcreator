/** Limits v to [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** 0 below e0, 1 above e1, a smooth S-curve between. */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
