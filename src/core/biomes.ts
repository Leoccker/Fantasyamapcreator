// Biome ids are persisted in the JSON, so never renumber them; only append.
export const Biome = {
  Ocean: 0,
  Lake: 1,
  Snow: 2,
  Tundra: 3,
  Taiga: 4,
  Forest: 5,
  Grassland: 6,
  Desert: 7,
  Swamp: 8,
  MagicForest: 9,
  CursedLand: 10,
  CrystalField: 11,
  MushroomForest: 12,
} as const
export type Biome = (typeof Biome)[keyof typeof Biome]

export const BIOME_COUNT = Object.keys(Biome).length

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Ocean]: 'Oceano',
  [Biome.Lake]: 'Lago',
  [Biome.Snow]: 'Neve',
  [Biome.Tundra]: 'Tundra',
  [Biome.Taiga]: 'Taiga',
  [Biome.Forest]: 'Floresta',
  [Biome.Grassland]: 'Campo',
  [Biome.Desert]: 'Deserto',
  [Biome.Swamp]: 'Pântano',
  [Biome.MagicForest]: 'Floresta mágica',
  [Biome.CursedLand]: 'Terra amaldiçoada',
  [Biome.CrystalField]: 'Campo de cristais',
  [Biome.MushroomForest]: 'Floresta de cogumelos',
}

export type LandBiome = Exclude<Biome, typeof Biome.Ocean | typeof Biome.Lake>
export type FantasyBiome = typeof Biome.MagicForest | typeof Biome.CursedLand | typeof Biome.CrystalField | typeof Biome.MushroomForest
/** What classify() produces from the climate; fantasy biomes are patches laid over these. */
export type ClassicBiome = Exclude<LandBiome, FantasyBiome>

export const isWaterBiome = (b: number) => b === Biome.Ocean || b === Biome.Lake

/** Marks "no hand-painted biome" in World.biomeOverride. */
export const NO_BIOME = 255

export const CLASSIC_BIOMES: ClassicBiome[] = [Biome.Snow, Biome.Tundra, Biome.Taiga, Biome.Forest, Biome.Grassland, Biome.Desert, Biome.Swamp]
export const FANTASY_BIOMES: FantasyBiome[] = [Biome.MagicForest, Biome.CursedLand, Biome.CrystalField, Biome.MushroomForest]
/** Biomes the paint brush may use and generation may be limited to: land only, since water comes from the relief. */
export const LAND_BIOMES: LandBiome[] = [...CLASSIC_BIOMES, ...FANTASY_BIOMES]
export const isPaintable = (b: number): b is LandBiome => (LAND_BIOMES as readonly number[]).includes(b)

/** A generation biome set in its saved form: ascending, without repeats; empty or absent means all land biomes. */
export const biomeSet = (b?: readonly LandBiome[]): LandBiome[] =>
  b?.length ? [...new Set(b)].sort((x, y) => x - y) : [...LAND_BIOMES]

/** Height above sea level scaled to 0..1 (0 at the shore, 1 at the highest possible peak). */
export const relAltitude = (elev: number, seaLevel: number) => Math.max(0, (elev - seaLevel) / (1 - seaLevel || 1))

/** Whittaker-style lookup from temperature/moisture (0..1) and relative altitude above sea (0..1). */
export function classify(temp: number, moist: number, relAlt: number): ClassicBiome {
  if (temp < 0.12) return Biome.Snow
  if (temp < 0.28) return Biome.Tundra
  if (temp < 0.45) return moist > 0.4 ? Biome.Taiga : Biome.Grassland
  if (moist < 0.22) return Biome.Desert
  if (moist > 0.78 && relAlt < 0.12) return Biome.Swamp
  if (moist > 0.48) return Biome.Forest
  return Biome.Grassland
}

/** The classic biomes a fantasy patch may appear in (judged on classify's result, before any fallback). */
export const FANTASY_HOSTS: Record<FantasyBiome, ClassicBiome[]> = {
  [Biome.MagicForest]: [Biome.Forest],
  [Biome.CursedLand]: [Biome.Grassland, Biome.Desert],
  [Biome.CrystalField]: [Biome.Snow, Biome.Tundra],
  [Biome.MushroomForest]: [Biome.Swamp],
}

/** For a biome left out of generation: the others, most similar first. */
const FALLBACK: Record<ClassicBiome, ClassicBiome[]> = {
  [Biome.Snow]: [Biome.Tundra, Biome.Taiga, Biome.Grassland, Biome.Forest, Biome.Swamp, Biome.Desert],
  [Biome.Tundra]: [Biome.Snow, Biome.Taiga, Biome.Grassland, Biome.Forest, Biome.Swamp, Biome.Desert],
  [Biome.Taiga]: [Biome.Forest, Biome.Tundra, Biome.Grassland, Biome.Snow, Biome.Swamp, Biome.Desert],
  [Biome.Forest]: [Biome.Taiga, Biome.Grassland, Biome.Swamp, Biome.Tundra, Biome.Desert, Biome.Snow],
  [Biome.Grassland]: [Biome.Forest, Biome.Tundra, Biome.Taiga, Biome.Desert, Biome.Swamp, Biome.Snow],
  [Biome.Desert]: [Biome.Grassland, Biome.Tundra, Biome.Forest, Biome.Taiga, Biome.Swamp, Biome.Snow],
  [Biome.Swamp]: [Biome.Forest, Biome.Grassland, Biome.Taiga, Biome.Tundra, Biome.Desert, Biome.Snow],
}

/** `b` if generation may use it, else its most similar allowed classic biome, else the first allowed (a fantasy one). */
export const resolveBiome = (b: ClassicBiome, allowed: readonly Biome[]): Biome =>
  allowed.includes(b) ? b : (FALLBACK[b].find((c) => allowed.includes(c)) ?? allowed[0])
