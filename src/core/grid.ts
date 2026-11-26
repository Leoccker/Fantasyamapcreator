// Grid geometry (pure): square or flat-top hexagonal cells sized in km.
import type { GridType, MapSettings } from './settings'

/** Smallest cell, in map units: below this the grid is a gray moiré and slow to draw. */
export const MIN_CELL_UNITS = 6
/** Most cells the grid may have over the whole map. */
export const MAX_GRID_CELLS = 20000

/** Cell size in map units for the settings, raised to stay readable and cheap; `clamped` tells the panel. */
export function gridCellUnits(s: Pick<MapSettings, 'gridKm' | 'kmPerUnit'>, W: number, H: number): { size: number; clamped: boolean } {
  const wanted = s.gridKm / s.kmPerUnit
  const size = Math.max(wanted, MIN_CELL_UNITS, Math.sqrt((W * H) / MAX_GRID_CELLS))
  return { size, clamped: size > wanted }
}

/** Center of flat-top hex (col, row) whose flat-to-flat width is `size`; odd columns sit half a cell lower. */
export function hexCenter(col: number, row: number, size: number): [number, number] {
  const R = size / Math.sqrt(3)
  return [1.5 * R * col, size * (row + (col & 1) / 2)]
}

/**
 * Grid lines covering [0, W] x [0, H] (and a cell beyond, so the edges are closed), as flat x1,y1,x2,y2.
 * Each hex emits only its lower-right, bottom and lower-left edges: every shared edge appears exactly once.
 */
export function gridSegments(type: GridType, size: number, W: number, H: number): Float32Array {
  const out: number[] = []
  if (type === 'square') {
    for (let x = 0; x <= W; x += size) out.push(x, 0, x, H)
    for (let y = 0; y <= H; y += size) out.push(0, y, W, y)
    return Float32Array.from(out)
  }
  const R = size / Math.sqrt(3)
  const h = size / 2 // half the flat-to-flat width
  const cols = Math.ceil(W / (1.5 * R)) + 1
  const rows = Math.ceil(H / size) + 1
  for (let c = -1; c <= cols; c++) {
    for (let r = -1; r <= rows; r++) {
      const [x, y] = hexCenter(c, r, size)
      // corners at 0°, 60°, 120°, 180° (y grows downward)
      out.push(x + R, y, x + R / 2, y + h) // lower-right
      out.push(x + R / 2, y + h, x - R / 2, y + h) // bottom
      out.push(x - R / 2, y + h, x - R, y) // lower-left
    }
  }
  return Float32Array.from(out)
}
