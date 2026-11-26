import { Biome, type LandBiome } from '../core/biomes'

export const PAPER = '#f1e4c3'
export const INK = '#3b2a1a'
export const WATER_TINT = 'rgba(96, 122, 128, 0.20)'
export const RIVER = '#4a6378'
export const TREE_FILL = '#c9c79a'
export const MAGIC_FILL = '#a9d9c0'
export const CRYSTAL_FILL = '#b5dcec'
export const MUSHROOM_FILL = '#d9a39c'
/** Colours of the marker icon shapes (core/icons.ts SHAPE_PAINTS). */
export const SHAPE_COLORS = { paper: PAPER, ink: INK }

/** Soft watercolor tones per land biome (they also make the legend). */
export const BIOME_COLORS: Record<LandBiome, string> = {
  [Biome.Snow]: '#f7f5ef',
  [Biome.Tundra]: '#c9c2a6',
  [Biome.Taiga]: '#8ea07c',
  [Biome.Forest]: '#9db27a',
  [Biome.Grassland]: '#d6d19a',
  [Biome.Desert]: '#e9c88a',
  [Biome.Swamp]: '#94a38a',
  [Biome.MagicForest]: '#6fbf9a',
  [Biome.CursedLand]: '#7e6b86',
  [Biome.CrystalField]: '#a8d5e2',
  [Biome.MushroomForest]: '#c98f8f',
}
