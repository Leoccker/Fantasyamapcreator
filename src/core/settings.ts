// Per-map display settings (saved in the World): grid, scale, where the scale bar and compass sit, the title.
// On/off switches are layers (UI state), not settings.
import { clamp } from './math'
import { scaleBarSpec } from './scale'
import type { World } from './world'

export const GRID_TYPES = ['square', 'hex'] as const
export type GridType = (typeof GRID_TYPES)[number]
export const GRID_TYPE_NAMES: Record<GridType, string> = { hex: 'Hexagonal', square: 'Quadrada' }
export const CORNERS = ['tl', 'tr', 'bl', 'br'] as const
export type Corner = (typeof CORNERS)[number]
export const CORNER_NAMES: Record<Corner, string> = { tl: 'Superior esquerdo', tr: 'Superior direito', bl: 'Inferior esquerdo', br: 'Inferior direito' }

export interface MapSettings {
  gridType: GridType
  /** Grid cell size in km. Hexes are flat-top; this is their flat-to-flat width (= distance between centers). */
  gridKm: number
  /** Map scale: km per map unit. */
  kmPerUnit: number
  scaleCorner: Corner
  compassCorner: Corner
  /** Shown in the frame; empty = the seed. */
  title: string
}

export const DEFAULT_SETTINGS: MapSettings = {
  gridType: 'hex',
  gridKm: 50,
  kmPerUnit: 1,
  scaleCorner: 'bl',
  compassCorner: 'tr',
  title: '',
}

export const SETTINGS_LIMITS = { gridKm: [0.1, 10000], kmPerUnit: [0.01, 1000], title: 80 } as const

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0 // + 0 turns -0 into 0

/** Applies a settings change (clamped). Returns the same World when nothing changes, so no empty undo step. */
export function patchSettings(w: World, p: Partial<MapSettings>): World {
  const next: MapSettings = { ...w.settings, ...p }
  if (p.gridKm !== undefined) next.gridKm = round4(clamp(p.gridKm, ...SETTINGS_LIMITS.gridKm))
  if (p.kmPerUnit !== undefined) next.kmPerUnit = round4(clamp(p.kmPerUnit, ...SETTINGS_LIMITS.kmPerUnit))
  if (p.title !== undefined) next.title = p.title.trim().slice(0, SETTINGS_LIMITS.title)
  const same = (Object.keys(next) as (keyof MapSettings)[]).every((k) => next[k] === w.settings[k])
  return same ? w : { ...w, settings: next }
}

export interface OverlayBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// Geometry shared with render/decor.ts so placement logic and spatial tools avoid covering the compass or scale bar.
export const OVERLAY_MARGIN = 30
export const SCALE_MAX_FRAC = 0.18
export const COMPASS_R = 42
export const COMPASS_LABEL = 24
export const STACK_GAP = 60

function cornerBox(corner: Corner, W: number, H: number, bw: number, bh: number, m: number, pad: number): OverlayBox {
  const x = corner[1] === 'l' ? m : W - m - bw
  const y = corner[0] === 't' ? m : H - m - bh
  return {
    minX: Math.max(0, x - pad),
    minY: Math.max(0, y - pad),
    maxX: Math.min(W, x + bw + pad),
    maxY: Math.min(H, y + bh + pad),
  }
}

/** Map-unit bounding boxes occupied by the scale bar and compass rose (expanded by `pad` thousandths of the short side). */
export function overlayBoxes(w: Pick<World, 'width' | 'height' | 'settings'>, pad = 14): { compass: OverlayBox; scaleBar: OverlayBox } {
  const k = Math.min(w.width, w.height) / 1000
  const m = OVERLAY_MARGIN * k
  const p = pad * k

  const { units } = scaleBarSpec(w.settings.kmPerUnit, w.width * SCALE_MAX_FRAC)
  const scaleW = Math.max(units, 80 * k) + 16 * k
  const scaleH = (6 + 16 * 1.4 + 10) * k
  const scaleBar = cornerBox(w.settings.scaleCorner, w.width, w.height, scaleW, scaleH, m, p)

  const compassSize = (2 * COMPASS_R + COMPASS_LABEL) * k
  const compass = cornerBox(w.settings.compassCorner, w.width, w.height, compassSize, compassSize, m, p)
  if (w.settings.scaleCorner === w.settings.compassCorner) {
    const shift = (w.settings.compassCorner[0] === 't' ? 1 : -1) * STACK_GAP * k
    compass.minY = Math.max(0, compass.minY + shift)
    compass.maxY = Math.min(w.height, compass.maxY + shift)
  }

  return { compass, scaleBar }
}

export const inBox = (x: number, y: number, b: OverlayBox) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
