// Map sizes the Gerador offers. A bigger map is more world at the same detail: the cell size stays the same, so
// cells grow with the area, and symbols, labels and markers keep their size.

export type SizeId = 'small' | 'medium' | 'large' | 'huge'

export interface MapSize {
  id: SizeId
  label: string
  width: number
  height: number
  /** 8000 per 1600x1000 (cells ~14 units apart), rounded to 500: 3000, 8000, 18000, 32000. */
  cells: number
}

type Box = { width: number; height: number }

/** A 16:10 size. */
function size(id: SizeId, label: string, width: number): MapSize {
  const height = width / 1.6
  return { id, label, width, height, cells: Math.round((width * height) / 200 / 500) * 500 }
}

export const SIZES: readonly MapSize[] = [size('small', 'Pequeno', 1000), size('medium', 'Médio', 1600), size('large', 'Grande', 2400), size('huge', 'Enorme', 3200)]
export const DEFAULT_SIZE = SIZES[1]

export const sizeById = (id: string): MapSize => SIZES.find((s) => s.id === id) ?? DEFAULT_SIZE

/** The size closest to a map's long side: maps from an SVG have the drawing's proportions, not 16:10. */
export function sizeOfWorld(w: Box): MapSize {
  const long = Math.max(w.width, w.height)
  return SIZES.reduce((a, b) => (Math.abs(b.width - long) < Math.abs(a.width - long) ? b : a))
}

/** Brush radius range and default, in map units: the same share of the map at every size (200 and 40 at Médio). */
export const RADIUS_MIN = 5
const short = (w: Box) => Math.min(w.width, w.height)
export const radiusMax = (w: Box) => Math.round(short(w) * 0.2)
export const radiusDefault = (w: Box) => Math.round(short(w) * 0.04)

/** Keeps the brush the same share of the map when another map size replaces it. */
export const scaleRadius = (r: number, from: Box, to: Box) =>
  Math.min(radiusMax(to), Math.max(RADIUS_MIN, Math.round((r * short(to)) / short(from))))
