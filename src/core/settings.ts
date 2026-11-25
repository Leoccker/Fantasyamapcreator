// Per-map display settings (saved in the World): grid, scale, where the scale bar and compass sit, the title.
// On/off switches are layers (UI state), not settings.
import { clamp } from './math'
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
