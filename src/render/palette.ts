import { Biome } from '../core/biomes'

export const PAPER = '#f1e4c3'
export const INK = '#3b2a1a'
export const WATER_TINT = 'rgba(96, 122, 128, 0.20)'
export const RIVER = '#4a6378'
export const TREE_FILL = '#c9c79a'
/** Colours of the marker icon shapes (core/icons.ts SHAPE_PAINTS). */
export const SHAPE_COLORS = { paper: PAPER, ink: INK }

/** Soft watercolor tones per land biome. */
export const BIOME_COLORS: Partial<Record<Biome, string>> = {
  [Biome.Snow]: '#f7f5ef',
  [Biome.Tundra]: '#c9c2a6',
  [Biome.Taiga]: '#8ea07c',
  [Biome.Forest]: '#9db27a',
  [Biome.Grassland]: '#d6d19a',
  [Biome.Desert]: '#e9c88a',
  [Biome.Swamp]: '#94a38a',
}
