// The persisted map. Only data that can't be recomputed (or that the user edits) lives here;
// the Delaunay/Voronoi mesh is rebuilt from `points` at runtime (see mesh.ts).
// biome and rivers are derivable, but are saved so the JSON is usable as game data on its own.
import { BIOME_COUNT, biomeSet, CLASSIC_BIOMES, isPaintable, isWaterBiome, NO_BIOME, type LandBiome } from './biomes'
import { deriveFeatures } from './features'
import { ICON_LIMITS, isIconSrc, MARKER_KINDS, type CustomIcon, type MarkerKind } from './icons'
import { CORNERS, DEFAULT_SETTINGS, GRID_TYPES, SETTINGS_LIMITS, type MapSettings } from './settings'

export const WORLD_VERSION = 7

/** Cells from source to mouth. The last cell is where it ends: ocean, lake, or the river it joins. */
export interface River {
  cells: number[]
  /** Accumulated flow per cell, same length as cells; drives the drawn width. */
  flow: number[]
}

/**
 * Generation inputs, exactly as requested, so generate({ seed, width, height, ...params }) reproduces the map.
 * Except for a map made from an SVG outline ("Importar mapa"): there they only fill the form for the next "Gerar".
 */
export interface GenParams {
  continents: number
  waterPct: number
  /** Requested count; the real count is points.length / 2 (rounded up to a full grid). */
  cellCount: number
  /** Kingdoms requested when generating (the real ones live in World.states). */
  kingdoms: number
  /** Land biomes generation may use, ascending ids; also used when an edit re-derives the biomes. */
  biomes: LandBiome[]
}

/** Allowed [min, max] for GenParams; shared by the UI and import validation. */
export const LIMITS = {
  continents: [1, 6],
  waterPct: [5, 95],
  cellCount: [1000, 40000],
  kingdoms: [0, 12],
} as const satisfies Record<Exclude<keyof GenParams, 'biomes'>, readonly [number, number]>

/** A kingdom. Its cells are the ones whose World.stateId equals its id. */
export interface State {
  id: number
  name: string
  /** #rrggbb */
  color: string
  /** Id of the capital's marker, or null. */
  capital: number | null
  /** Set only on generated items; any hand edit removes it, so "Gerar reinos" knows what it may replace. */
  auto?: true
}

export { MARKER_KINDS, type MarkerKind } from './icons'

/** A point of interest, stored by position (not cell) so it survives terrain edits. */
export interface Marker {
  id: number
  kind: MarkerKind
  x: number
  y: number
  name: string
  notes: string
  /** Id of an uploaded icon (World.icons) drawn instead of the kind's; the kind still sets the name style. */
  icon?: number
  auto?: true
}

/** Free text on the map. size is in map units (it scales with the map), rotation in degrees. */
export interface Label {
  id: number
  text: string
  x: number
  y: number
  size: number
  rotation: number
  auto?: true
}

/** Caps for untrusted files and for the editors. */
export const TEXT_LIMITS = { name: 120, notes: 2000, label: 200, labelSize: [4, 200], items: 5000, states: 1000 } as const

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
  /** Per-cell Biome id (see biomes.ts). Ocean and Lake are water. Already includes the painted biomes. */
  biome: Uint8Array
  /** Hand-painted land biome per cell, NO_BIOME where unpainted. Survives elevation edits; water still wins. */
  biomeOverride: Uint8Array
  rivers: River[]
  /** Kingdom id per cell (0 = none). Water cells are always 0. */
  stateId: Uint16Array
  states: State[]
  markers: Marker[]
  labels: Label[]
  /** Next id for a marker or label. Never reused, so undo/selection can't land on a different item. */
  nextId: number
  /** Uploaded marker icons. Kept when a new map is generated, like the settings. */
  icons: CustomIcon[]
  settings: MapSettings
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
    biomeOverride: sparseOverride(w.biomeOverride),
    stateId: Array.from(w.stateId),
  })
}

/** Flat [cell0, biome0, cell1, biome1, ...] of painted cells only; [] for an unedited map. */
function sparseOverride(o: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < o.length; i++) if (o[i] !== NO_BIOME) out.push(i, o[i])
  return out
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
    kingdoms: version >= 4 ? int(p.kingdoms, 'params.kingdoms', ...LIMITS.kingdoms) : 0,
    // v1-v6 maps were made before fantasy biomes: the classic ones keep re-derived biomes as they were.
    biomes: version >= 7 ? parseBiomeSet(p.biomes) : [...CLASSIC_BIOMES],
  }
  const seaLevel = range(o.seaLevel, 'seaLevel', 0, 1)

  const pts = numArray(o.points, 'points')
  const n = pts.length / 2
  const maxCells = 2 * LIMITS.cellCount[1] // the real grid count can exceed the requested one a little
  if (!Number.isInteger(n) || n < 3 || n > maxCells)
    throw new WorldParseError(`points deve ter pares x,y (de 3 a ${maxCells} células).`)
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < 0 || pts[i] > width || pts[i + 1] < 0 || pts[i + 1] > height)
      throw new WorldParseError(`Ponto ${i / 2} está fora do mapa.`)
  }
  const h = numArray(o.elevation, 'elevation', n)
  if (h.some((v) => v < 0 || v > 1)) throw new WorldParseError('elevation deve estar entre 0 e 1.')

  // v1/v2 files have no painted biomes.
  const biomeOverride = version >= 3 ? parseOverride(o.biomeOverride, n) : new Uint8Array(n).fill(NO_BIOME)
  const terrain = { seed: o.seed, width, height, seaLevel, points: Float32Array.from(pts), elevation: Float32Array.from(h), biomeOverride }
  // v1 files have no biomes/rivers: derive them, exactly as generate() would.
  const { biome, rivers } =
    version === 1 ? deriveFeatures(terrain) : { biome: parseBiome(o.biome, n), rivers: parseRivers(o.rivers, n) }

  // v1-v3 files have no kingdoms or places (their reserved lists were always empty): load them empty.
  // Kingdoms are not generated here: that would silently change a saved map; "Gerar reinos" does it, undoably.
  const places = version >= 4 ? parsePlaces(o, version, n, width, height, biome) : emptyPlaces(n)

  // v1-v4 files have no settings: use the defaults.
  const settings = version >= 5 ? parseSettings(o.settings) : { ...DEFAULT_SETTINGS }

  return { version: WORLD_VERSION, ...terrain, params, biome, rivers, ...places, settings }
}

function parseSettings(v: unknown): MapSettings {
  const o = obj(v, 'settings')
  const oneOf = <T extends string>(x: unknown, name: string, list: readonly T[]): T => {
    if (!list.includes(x as T)) throw new WorldParseError(`settings.${name} deve ser ${list.join(', ')}.`)
    return x as T
  }
  return {
    gridType: oneOf(o.gridType, 'gridType', GRID_TYPES),
    gridKm: range(o.gridKm, 'settings.gridKm', ...SETTINGS_LIMITS.gridKm),
    kmPerUnit: range(o.kmPerUnit, 'settings.kmPerUnit', ...SETTINGS_LIMITS.kmPerUnit),
    scaleCorner: oneOf(o.scaleCorner, 'scaleCorner', CORNERS),
    compassCorner: oneOf(o.compassCorner, 'compassCorner', CORNERS),
    title: str(o.title, 'settings.title', SETTINGS_LIMITS.title),
  }
}

type Places = Pick<World, 'stateId' | 'states' | 'markers' | 'labels' | 'nextId' | 'icons'>

const emptyPlaces = (n: number): Places => ({ stateId: new Uint16Array(n), states: [], markers: [], labels: [], nextId: 1, icons: [] })

function parsePlaces(o: Record<string, unknown>, version: number, n: number, width: number, height: number, biome: Uint8Array): Places {
  const nextId = int(o.nextId, 'nextId', 1, 1e9)
  const ids = new Set<number>()
  const uniqueId = (v: unknown, name: string, max: number) => {
    const id = int(v, name, 1, max)
    if (ids.has(id)) throw new WorldParseError(`${name}: id ${id} repetido.`)
    ids.add(id)
    return id
  }
  const pos = (r: Record<string, unknown>, name: string) => ({
    x: range(r.x, `${name}.x`, 0, width),
    y: range(r.y, `${name}.y`, 0, height),
  })

  // v1-v5 files have no uploaded icons. Icon ids are their own series (markers point at them, nothing selects them).
  const iconIds = new Set<number>()
  const icons =
    version >= 6
      ? list(o.icons, 'icons', ICON_LIMITS.count, (r, name): CustomIcon => {
          const id = int(r.id, `${name}.id`, 1, 1e9)
          if (iconIds.has(id)) throw new WorldParseError(`${name}: id ${id} repetido.`)
          iconIds.add(id)
          if (!isIconSrc(r.src)) throw new WorldParseError(`${name}.src deve ser uma imagem PNG ou WebP embutida (até ${ICON_LIMITS.src} caracteres).`)
          return { id, name: str(r.name, `${name}.name`, TEXT_LIMITS.name), src: r.src }
        })
      : []

  const markers = list(o.markers, 'markers', TEXT_LIMITS.items, (r, name): Marker => {
    const kind = r.kind as MarkerKind
    if (!MARKER_KINDS.includes(kind)) throw new WorldParseError(`${name}.kind desconhecido.`)
    const icon = r.icon === undefined ? undefined : int(r.icon, `${name}.icon`, 1, 1e9)
    if (icon !== undefined && !iconIds.has(icon)) throw new WorldParseError(`${name}.icon aponta para um ícone que não existe.`)
    return {
      id: uniqueId(r.id, `${name}.id`, nextId - 1),
      kind,
      ...pos(r, name),
      name: str(r.name, `${name}.name`, TEXT_LIMITS.name),
      notes: str(r.notes, `${name}.notes`, TEXT_LIMITS.notes),
      ...(icon === undefined ? {} : { icon }),
      ...auto(r, name),
    }
  })
  const labels = list(o.labels, 'labels', TEXT_LIMITS.items, (r, name): Label => ({
    id: uniqueId(r.id, `${name}.id`, nextId - 1),
    text: str(r.text, `${name}.text`, TEXT_LIMITS.label),
    ...pos(r, name),
    size: range(r.size, `${name}.size`, ...TEXT_LIMITS.labelSize),
    rotation: range(r.rotation, `${name}.rotation`, -360, 360),
    ...auto(r, name),
  }))

  const markerIds = new Set(markers.map((m) => m.id))
  const stateIds = new Set<number>()
  const states = list(o.states, 'states', TEXT_LIMITS.states, (r, name): State => {
    const id = int(r.id, `${name}.id`, 1, 65535)
    if (stateIds.has(id)) throw new WorldParseError(`${name}: id ${id} repetido.`)
    stateIds.add(id)
    const color = r.color
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color)) throw new WorldParseError(`${name}.color deve ser #rrggbb.`)
    const capital = r.capital === null ? null : int(r.capital, `${name}.capital`, 1, 1e9)
    if (capital !== null && !markerIds.has(capital)) throw new WorldParseError(`${name}.capital aponta para um marcador que não existe.`)
    return { id, name: str(r.name, `${name}.name`, TEXT_LIMITS.name), color, capital, ...auto(r, name) }
  })

  const raw = numArray(o.stateId, 'stateId', n)
  const stateId = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const s = raw[i]
    if (s !== 0 && !stateIds.has(s)) throw new WorldParseError(`stateId: reino ${s} não existe.`)
    stateId[i] = isWaterBiome(biome[i]) ? 0 : s // water never belongs to a kingdom
  }
  return { stateId, states, markers, labels, nextId, icons }
}

function list<T>(v: unknown, name: string, max: number, parseOne: (r: Record<string, unknown>, name: string) => T): T[] {
  const arr = optArray(v, name)
  if (arr.length > max) throw new WorldParseError(`${name}: no máximo ${max} itens.`)
  return arr.map((r, k) => parseOne(obj(r, `${name}[${k}]`), `${name}[${k}]`))
}

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string') throw new WorldParseError(`${name} deve ser texto.`)
  if (v.length > max) throw new WorldParseError(`${name}: no máximo ${max} caracteres.`)
  return v
}

/** `auto` is either absent or true; writing auto: false would break the exact save -> load equality. */
function auto(r: Record<string, unknown>, name: string): { auto?: true } {
  if (r.auto === undefined) return {}
  if (r.auto !== true) throw new WorldParseError(`${name}.auto deve ser true ou ausente.`)
  return { auto: true }
}

function parseBiome(v: unknown, n: number): Uint8Array {
  const b = numArray(v, 'biome', n)
  if (!b.every((x) => Number.isInteger(x) && x >= 0 && x < BIOME_COUNT)) throw new WorldParseError('biome contém ids desconhecidos.')
  return Uint8Array.from(b)
}

function parseBiomeSet(v: unknown): LandBiome[] {
  const b = numArray(v, 'params.biomes')
  if (!b.length || new Set(b).size !== b.length || !b.every(isPaintable))
    throw new WorldParseError('params.biomes deve listar biomas de terra distintos (ao menos um).')
  return biomeSet(b)
}

function parseOverride(v: unknown, n: number): Uint8Array {
  const flat = numArray(v, 'biomeOverride')
  if (flat.length % 2) throw new WorldParseError('biomeOverride deve ter pares célula, bioma.')
  const out = new Uint8Array(n).fill(NO_BIOME)
  for (let k = 0; k < flat.length; k += 2) {
    const [cell, b] = [flat[k], flat[k + 1]]
    if (!Number.isInteger(cell) || cell < 0 || cell >= n) throw new WorldParseError(`biomeOverride: célula ${cell} não existe.`)
    if (!isPaintable(b)) throw new WorldParseError(`biomeOverride: bioma ${b} não pode ser pintado.`)
    if (out[cell] !== NO_BIOME) throw new WorldParseError(`biomeOverride: célula ${cell} repetida.`)
    out[cell] = b
  }
  return out
}

function parseRivers(v: unknown, n: number): River[] {
  return optArray(v, 'rivers').map((r, k) => {
    const o = obj(r, `rivers[${k}]`)
    const cells = numArray(o.cells, `rivers[${k}].cells`)
    if (cells.length < 2 || !cells.every((c) => Number.isInteger(c) && c >= 0 && c < n))
      throw new WorldParseError(`rivers[${k}].cells tem células inválidas.`)
    const flow = numArray(o.flow, `rivers[${k}].flow`, cells.length)
    if (flow.some((f) => f < 0)) throw new WorldParseError(`rivers[${k}].flow não pode ser negativo.`)
    return { cells, flow }
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
