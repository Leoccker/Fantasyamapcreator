// Deterministic world generation: same GenInput -> same World.
import { createNoise2D } from 'simplex-noise'
import { biomeSet, LAND_BIOMES, NO_BIOME, type LandBiome } from './biomes'
import { deriveFeatures } from './features'
import { generateKingdoms } from './kingdoms'
import { DEFAULT_SIZE } from './mapSize'
import { smoothstep } from './math'
import { rngFor } from './rng'
import { DEFAULT_SETTINGS } from './settings'
import { ELEVATION_DECIMALS, POINT_DECIMALS, round, WORLD_VERSION, type GenParams, type World } from './world'

export interface GenInput {
  seed: string
  width: number
  height: number
  continents: number
  waterPct: number
  cellCount: number
  /** Kingdoms to create; 0 or absent = none. */
  kingdoms?: number
  /** Land biomes generation may use; absent = all of them. */
  biomes?: LandBiome[]
}

export const DEFAULTS: Required<GenInput> = {
  seed: 'fantasy',
  width: DEFAULT_SIZE.width,
  height: DEFAULT_SIZE.height,
  continents: 3,
  waterPct: 60,
  cellCount: DEFAULT_SIZE.cells,
  kingdoms: 5,
  biomes: [...LAND_BIOMES],
}

export function generate(input: GenInput): World {
  const { seed, width: w, height: h, continents, waterPct, cellCount, kingdoms = 0 } = input
  const biomes = biomeSet(input.biomes)
  const points = jitteredPoints(rngFor(seed, 'points'), w, h, cellCount)
  const elevation = elevationField(points, w, h, seed, continents)
  const terrain = { seed, width: w, height: h, seaLevel: seaLevelFor(elevation, waterPct), points, elevation }
  return worldFromTerrain(terrain, { continents, waterPct, cellCount, kingdoms, biomes })
}

export type Terrain = Pick<World, 'seed' | 'width' | 'height' | 'seaLevel' | 'points' | 'elevation'>

/** A fresh World on the given terrain: derived biomes and rivers, no places, and kingdoms if asked for. */
export function worldFromTerrain(terrain: Terrain, params: GenParams): World {
  const n = terrain.points.length / 2
  const base: World = {
    version: WORLD_VERSION,
    ...terrain,
    params,
    ...deriveFeatures({ ...terrain, biomes: params.biomes }),
    biomeOverride: new Uint8Array(n).fill(NO_BIOME),
    stateId: new Uint16Array(n),
    states: [],
    markers: [],
    labels: [],
    nextId: 1,
    icons: [],
    settings: DEFAULT_SETTINGS,
  }
  return params.kingdoms > 0 ? generateKingdoms(base, params.kingdoms) : base
}

/** Grid of about `count` points, each jittered inside its grid cell. Actual count is cols*rows. */
export function jitteredPoints(rng: () => number, w: number, h: number, count: number): Float32Array {
  const cols = Math.ceil(Math.sqrt((count * w) / h))
  const rows = Math.ceil(count / cols)
  const dx = w / cols
  const dy = h / rows
  const pts = new Float32Array(cols * rows * 2)
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts[k++] = round((c + 0.5 + (rng() - 0.5) * 0.8) * dx, POINT_DECIMALS)
      pts[k++] = round((r + 0.5 + (rng() - 0.5) * 0.8) * dy, POINT_DECIMALS)
    }
  }
  return pts
}

interface Continent {
  cx: number
  cy: number
  r: number
  sx: number
  sy: number
}

/** Continent centers, spread out by dart-throwing. Coordinates normalized to 0..1. */
function placeContinents(rng: () => number, k: number): Continent[] {
  const minDist = 0.35 / Math.sqrt(k)
  const margin = 0.12
  const blobs: Continent[] = []
  for (let b = 0; b < k; b++) {
    let cx = 0
    let cy = 0
    for (let t = 0; t < 20; t++) {
      cx = margin + rng() * (1 - 2 * margin)
      cy = margin + rng() * (1 - 2 * margin)
      if (blobs.every((o) => Math.sqrt((o.cx - cx) ** 2 + (o.cy - cy) ** 2) >= minDist)) break
    }
    const r = ((0.16 + rng() * 0.1) / Math.sqrt(k)) * 1.6
    blobs.push({ cx, cy, r, sx: 0.8 + rng() * 0.45, sy: 0.8 + rng() * 0.45 })
  }
  return blobs
}

/** Fractal (5-octave) noise over normalized map coordinates, in 0..1. `aspect` keeps features round. */
export function fractalNoise(noise: (x: number, y: number) => number, aspect: number): (u: number, v: number) => number {
  return (u, v) => {
    let sum = 0
    let amp = 1
    let norm = 0
    let f = 2.5
    for (let o = 0; o < 5; o++) {
      sum += amp * noise(u * aspect * f, v * f)
      norm += amp
      amp *= 0.5
      f *= 2
    }
    return (sum / norm + 1) / 2
  }
}

export function elevationField(points: Float32Array, w: number, h: number, seed: string, continents: number): Float32Array {
  const noise = createNoise2D(rngFor(seed, 'noise'))
  const blobs = placeContinents(rngFor(seed, 'blobs'), continents)
  const aspect = w / h
  const n = points.length / 2
  const out = new Float32Array(n)

  const fbm = fractalNoise(noise, aspect)

  const mask = (u: number, v: number) => {
    let m = 0
    for (const b of blobs) {
      const du = ((u - b.cx) * aspect) / b.sx
      const dv = (v - b.cy) / b.sy
      const f = Math.max(0, 1 - (du * du + dv * dv) / (b.r * b.r))
      m = Math.max(m, f * f) // max, not sum: overlapping blobs merge without a ridge
    }
    return m
  }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const u = points[2 * i] / w
    const v = points[2 * i + 1] / h
    // Domain warp so coasts aren't perfect ellipses.
    const m = mask(u + 0.06 * noise(u * 3 + 10, v * 3), v + 0.06 * noise(u * 3, v * 3 + 10))
    const edge = smoothstep(0, 0.08, Math.min(u, 1 - u, v, 1 - v)) // map border is always sea
    const x = (m * 0.7 + fbm(u, v) * 0.3 * (0.35 + 0.65 * m)) * edge
    out[i] = x
    if (x < min) min = x
    if (x > max) max = x
  }
  const span = max - min || 1
  for (let i = 0; i < n; i++) out[i] = round((out[i] - min) / span, ELEVATION_DECIMALS)
  return out
}

/** Sea level as a height percentile, so `waterPct` of the cells end up under water. */
export function seaLevelFor(elevation: Float32Array, waterPct: number): number {
  const s = Float32Array.from(elevation).sort()
  const i = Math.min(s.length - 1, Math.max(0, Math.round((waterPct / 100) * (s.length - 1))))
  return s[i]
}
