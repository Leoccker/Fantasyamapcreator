// Where a brush-stroke preview must redraw the cached map: pure, so the rect math is tested without a canvas.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * How far past its anchor point a map item paints (map units): a cell's tint (its size, up to ~40 on coarse
 * maps, plus the blur), the sea hatching around a coast point (25) and relief symbols (~25). Both what a stroke
 * preview redraws around a changed cell and what a canvas draws around what it shows (see draw.ts).
 */
export const REACH = 55
/** Drawn around the copied part and thrown away (map units): the blur (~3x its 3-unit radius) smears it. */
const RING = 10
/** Past this share of the cache a patch costs about as much as a full render. */
const MAX_SHARE = 0.5

/**
 * Device-pixel rects around `cells` on a cache of cw x ch drawn at `scale`, integer and clamped to it: `outer` is
 * drawn, `inner` (inside it) copied into the cache. null: nothing to redraw, or a full render is as cheap.
 */
export function patchRects(polys: readonly (ArrayLike<number> | null)[], cells: Iterable<number>, scale: number, cw: number, ch: number) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of cells) {
    const p = polys[i]
    if (!p) continue
    for (let k = 0; k < p.length; k += 2) {
      x0 = Math.min(x0, p[k])
      x1 = Math.max(x1, p[k])
      y0 = Math.min(y0, p[k + 1])
      y1 = Math.max(y1, p[k + 1])
    }
  }
  if (x0 === Infinity) return null
  const grow = (m: number): Rect => {
    const x = Math.max(0, Math.floor((x0 - m) * scale))
    const y = Math.max(0, Math.floor((y0 - m) * scale))
    return { x, y, w: Math.min(cw, Math.ceil((x1 + m) * scale)) - x, h: Math.min(ch, Math.ceil((y1 + m) * scale)) - y }
  }
  const inner = grow(REACH)
  if (inner.w * inner.h > MAX_SHARE * cw * ch) return null
  return { outer: grow(REACH + RING), inner }
}
