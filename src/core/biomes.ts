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
}

export const isWaterBiome = (b: number) => b === Biome.Ocean || b === Biome.Lake

/** Marks "no hand-painted biome" in World.biomeOverride. */
export const NO_BIOME = 255

/** Biomes the paint brush may use: land only, since water comes from the relief. */
export const LAND_BIOMES: Biome[] = [Biome.Snow, Biome.Tundra, Biome.Taiga, Biome.Forest, Biome.Grassland, Biome.Desert, Biome.Swamp]
export const isPaintable = (b: number) => (LAND_BIOMES as number[]).includes(b)

/** Height above sea level scaled to 0..1 (0 at the shore, 1 at the highest possible peak). */
export const relAltitude = (elev: number, seaLevel: number) => Math.max(0, (elev - seaLevel) / (1 - seaLevel || 1))

/** Whittaker-style lookup from temperature/moisture (0..1) and relative altitude above sea (0..1). */
export function classify(temp: number, moist: number, relAlt: number): Biome {
  if (temp < 0.12) return Biome.Snow
  if (temp < 0.28) return Biome.Tundra
  if (temp < 0.45) return moist > 0.4 ? Biome.Taiga : Biome.Grassland
  if (moist < 0.22) return Biome.Desert
  if (moist > 0.78 && relAlt < 0.12) return Biome.Swamp
  if (moist > 0.48) return Biome.Forest
  return Biome.Grassland
}
