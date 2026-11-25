// The persisted map. Only data that can't be recomputed (or that the user edits) lives here;
// the Delaunay/Voronoi mesh is rebuilt from `points` at runtime (see mesh.ts).
// biome and rivers are derivable, but are saved so the JSON is usable as game data on its own.
import { BIOME_COUNT } from './biomes'
import { deriveFeatures } from './features'

export const WORLD_VERSION = 2

/** Cells from source to mouth. The last cell is where it ends: ocean, lake, or the river it joins. */
export interface River {
  cells: number[]
  /** Accumulated flow per cell, same length as cells; drives the drawn width. */
  flow: number[]
}

/** Generation inputs, exactly as requested, so generate({ seed, width, height, ...params }) reproduces the map. */
export interface GenParams {
  continents: number
  waterPct: number
  /** Requested count; the real count is points.length / 2 (rounded up to a full grid). */
  cellCount: number
}

/** Allowed [min, max] for GenParams; shared by the UI and import validation. */
export const LIMITS = {
  continents: [1, 6],
  waterPct: [5, 95],
  cellCount: [1000, 20000],
} as const satisfies Record<keyof GenParams, readonly [number, number]>

export interface World {
  version: number
  seed: string
  width: number
  height: number
  params: GenParams
  seaLevel: number
  /** Flat [x0, y0, x1, y1, ...]; cell i = point i. */
  points: Float32Array
  /** Per-cell elevation, 0..1. Land is elevation >= seaLevel. */
  elevation: Float32Array
  /** Per-cell Biome id (see biomes.ts). Ocean and Lake are water. */
  biome: Uint8Array
  rivers: River[]
  // Reserved for later phases; always [].
  states: unknown[]
  markers: unknown[]
  labels: unknown[]
}

export class WorldParseError extends Error {
  name = 'WorldParseError'
}

// Decimals kept on disk; generate() rounds to the same so save -> load is exact.
export const POINT_DECIMALS = 2
export const ELEVATION_DECIMALS = 3

export const round = (v: number, d: number) => {
  const k = 10 ** d
  return Math.round(v * k) / k + 0 // + 0 turns -0 into 0, which is what JSON gives back
}

export function serializeWorld(w: World): string {
  return JSON.stringify({
    ...w,
    points: Array.from(w.points, (v) => round(v, POINT_DECIMALS)),
    elevation: Array.from(w.elevation, (v) => round(v, ELEVATION_DECIMALS)),
    biome: Array.from(w.biome),
  })
}

/** Parses and fully validates a saved world. Throws WorldParseError; never returns a half-valid World. */
export function parseWorld(json: string): World {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new WorldParseError('O arquivo não é um JSON válido.')
  }
  const o = obj(raw, 'mapa')
  const version = num(o.version, 'version')
  if (version > WORLD_VERSION) throw new WorldParseError(`Versão ${version} é mais nova que este app (${WORLD_VERSION}).`)
  if (version < 1 || !Number.isInteger(version)) throw new WorldParseError(`Versão inválida: ${version}.`)
  if (typeof o.seed !== 'string') throw new WorldParseError('seed deve ser texto.')
  const width = range(o.width, 'width', 100, 8000)
  const height = range(o.height, 'height', 100, 8000)
  const p = obj(o.params, 'params')
  const params: GenParams = {
    continents: int(p.continents, 'params.continents', ...LIMITS.continents),
    waterPct: int(p.waterPct, 'params.waterPct', ...LIMITS.waterPct),
    cellCount: int(p.cellCount, 'params.cellCount', ...LIMITS.cellCount),
  }
  const seaLevel = range(o.seaLevel, 'seaLevel', 0, 1)

  const pts = numArray(o.points, 'points')
  const n = pts.length / 2
  if (!Number.isInteger(n) || n < 3 || n > 2 * LIMITS.cellCount[1])
    throw new WorldParseError('points deve ter pares x,y (de 3 a 40000 células).')
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < 0 || pts[i] > width || pts[i + 1] < 0 || pts[i + 1] > height)
      throw new WorldParseError(`Ponto ${i / 2} está fora do mapa.`)
  }
  const h = numArray(o.elevation, 'elevation', n)
  if (h.some((v) => v < 0 || v > 1)) throw new WorldParseError('elevation deve estar entre 0 e 1.')

  const terrain = { seed: o.seed, width, height, seaLevel, points: Float32Array.from(pts), elevation: Float32Array.from(h) }
  // v1 files have no biomes/rivers: derive them, exactly as generate() would.
  const { biome, rivers } =
    version === 1 ? deriveFeatures(terrain) : { biome: parseBiome(o.biome, n), rivers: parseRivers(o.rivers, n) }

  return {
    version: WORLD_VERSION,
    ...terrain,
    params,
    biome,
    rivers,
    states: optArray(o.states, 'states'),
    markers: optArray(o.markers, 'markers'),
    labels: optArray(o.labels, 'labels'),
  }
}

function parseBiome(v: unknown, n: number): Uint8Array {
  const b = numArray(v, 'biome', n)
  if (!b.every((x) => Number.isInteger(x) && x >= 0 && x < BIOME_COUNT)) throw new WorldParseError('biome contém ids desconhecidos.')
  return Uint8Array.from(b)
}

function parseRivers(v: unknown, n: number): River[] {
  return optArray(v, 'rivers').map((r, k) => {
    const o = obj(r, `rivers[${k}]`)
    const cells = numArray(o.cells, `rivers[${k}].cells`)
    if (cells.length < 2 || !cells.every((c) => Number.isInteger(c) && c >= 0 && c < n))
      throw new WorldParseError(`rivers[${k}].cells tem células inválidas.`)
    return { cells, flow: numArray(o.flow, `rivers[${k}].flow`, cells.length) }
  })
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WorldParseError(`${name} deve ser um objeto.`)
  return v as Record<string, unknown>
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldParseError(`${name} deve ser um número.`)
  return v
}

function range(v: unknown, name: string, min: number, max: number): number {
  const x = num(v, name)
  if (x < min || x > max) throw new WorldParseError(`${name} deve estar entre ${min} e ${max}.`)
  return x
}

function int(v: unknown, name: string, min: number, max: number): number {
  const x = range(v, name, min, max)
  if (!Number.isInteger(x)) throw new WorldParseError(`${name} deve ser inteiro.`)
  return x
}

function numArray(v: unknown, name: string, length?: number): number[] {
  if (!Array.isArray(v)) throw new WorldParseError(`${name} deve ser uma lista de números.`)
  if (length !== undefined && v.length !== length) throw new WorldParseError(`${name} deve ter ${length} números.`)
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new WorldParseError(`${name} contém valores inválidos.`)
  return v
}

function optArray(v: unknown, name: string): unknown[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new WorldParseError(`${name} deve ser uma lista.`)
  return v
}
