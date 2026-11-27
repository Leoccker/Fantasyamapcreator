// Compact world summaries and semantic spatial queries so AIs can reason about geography without raw cell arrays.
import { Biome, BIOME_NAMES, isPaintable, isWaterBiome, relAltitude, type LandBiome } from '../core/biomes'
import { stateCenter } from '../core/kingdoms'
import { clamp } from '../core/math'
import { getMesh, isLand } from '../core/mesh'
import { POINT_DECIMALS, round, type World } from '../core/world'

export type BiomeKey = keyof typeof Biome

export const BIOME_KEYS = Object.keys(Biome) as BiomeKey[]
export const LAND_BIOME_KEYS = BIOME_KEYS.filter((k) => isPaintable(Biome[k])) as Exclude<BiomeKey, 'Ocean' | 'Lake'>[]

const KEY_BY_ID: Record<number, BiomeKey> = Object.fromEntries(BIOME_KEYS.map((k) => [Biome[k], k]))

export function biomeKeyOf(id: number): BiomeKey {
  return KEY_BY_ID[id] ?? 'Ocean'
}

/** Parses a biome by enum key ("MagicForest"), case-insensitive key, or Portuguese display name ("Floresta mágica"). */
export function parseBiome(input: string): Biome | null {
  const norm = input.trim().toLowerCase()
  for (const key of BIOME_KEYS) {
    const id = Biome[key]
    if (key.toLowerCase() === norm || BIOME_NAMES[id].toLowerCase() === norm) return id
  }
  return null
}

export function parseLandBiome(input: string): LandBiome | null {
  const id = parseBiome(input)
  return id !== null && isPaintable(id) ? id : null
}

export interface WorldSummary {
  meta: {
    seed: string
    width: number
    height: number
    cellCount: number
    seaLevel: number
    landCells: number
    waterCells: number
    oceanCells: number
    lakeCells: number
    landPct: number
    waterPct: number
  }
  settings: World['settings']
  biomes: { key: BiomeKey; name: string; cells: number; pct: number }[]
  kingdoms: {
    id: number
    name: string
    color: string
    capitalId: number | null
    capitalName: string | null
    cells: number
    pctOfLand: number
    center: { x: number; y: number } | null
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
    neighbors: number[]
    hasCoast: boolean
  }[]
  rivers: {
    total: number
    major: { index: number; cells: number; maxFlow: number; source: { x: number; y: number }; mouth: { x: number; y: number } }[]
  }
  markers: {
    total: number
    truncated: boolean
    items: { id: number; kind: string; name: string; x: number; y: number; hasNotes: boolean }[]
  }
  labels: {
    total: number
    truncated: boolean
    items: { id: number; text: string; x: number; y: number; size: number; rotation: number }[]
  }
}

const MAX_LIST_ITEMS = 100
const MAX_MAJOR_RIVERS = 15

export function inspectWorld(w: World): WorldSummary {
  const mesh = getMesh(w)
  const n = mesh.n
  let landCells = 0
  let oceanCells = 0
  let lakeCells = 0

  const biomeCounts = new Map<number, number>()
  const stateStats = new Map<
    number,
    { cells: number; minX: number; minY: number; maxX: number; maxY: number; neighbors: Set<number>; hasCoast: boolean }
  >()
  for (const st of w.states) {
    stateStats.set(st.id, { cells: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, neighbors: new Set(), hasCoast: false })
  }

  for (let i = 0; i < n; i++) {
    const b = w.biome[i]
    biomeCounts.set(b, (biomeCounts.get(b) ?? 0) + 1)
    if (b === Biome.Ocean) oceanCells++
    else if (b === Biome.Lake) lakeCells++
    else landCells++

    const sid = w.stateId[i]
    if (sid) {
      const st = stateStats.get(sid)
      if (st) {
        const x = w.points[2 * i]
        const y = w.points[2 * i + 1]
        st.cells++
        if (x < st.minX) st.minX = x
        if (y < st.minY) st.minY = y
        if (x > st.maxX) st.maxX = x
        if (y > st.maxY) st.maxY = y
        for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) {
          const j = mesh.nIdx[k]
          if (isWaterBiome(w.biome[j])) st.hasCoast = true
          else if (w.stateId[j] && w.stateId[j] !== sid) st.neighbors.add(w.stateId[j])
        }
      }
    }
  }

  const waterCells = oceanCells + lakeCells
  const pct = (c: number, total: number) => (total > 0 ? round((c / total) * 100, 1) : 0)

  const biomes = [...biomeCounts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, cells]) => ({
      key: biomeKeyOf(id),
      name: BIOME_NAMES[id as Biome] ?? String(id),
      cells,
      pct: pct(cells, n),
    }))

  const markerById = new Map(w.markers.map((m) => [m.id, m]))
  const kingdoms = w.states.map((st) => {
    const info = stateStats.get(st.id)!
    const c = stateCenter(w, st.id)
    const cap = st.capital !== null ? markerById.get(st.capital) : undefined
    return {
      id: st.id,
      name: st.name,
      color: st.color,
      capitalId: st.capital,
      capitalName: cap?.name ?? null,
      cells: info.cells,
      pctOfLand: pct(info.cells, landCells),
      center: c ? { x: round(c[0], POINT_DECIMALS), y: round(c[1], POINT_DECIMALS) } : null,
      bounds:
        info.cells > 0
          ? {
              minX: round(info.minX, POINT_DECIMALS),
              minY: round(info.minY, POINT_DECIMALS),
              maxX: round(info.maxX, POINT_DECIMALS),
              maxY: round(info.maxY, POINT_DECIMALS),
            }
          : null,
      neighbors: [...info.neighbors].sort((a, b) => a - b),
      hasCoast: info.hasCoast,
    }
  })

  const majorRivers = w.rivers
    .map((r, index) => {
      const src = r.cells[0]
      const endIdx = r.cells.length - 1
      const mouthCell = endIdx > 0 && !isLand(w, r.cells[endIdx]) ? r.cells[endIdx - 1] : r.cells[endIdx]
      return {
        index,
        cells: r.cells.length,
        maxFlow: r.flow[endIdx] ?? 0,
        source: { x: round(w.points[2 * src], POINT_DECIMALS), y: round(w.points[2 * src + 1], POINT_DECIMALS) },
        mouth: { x: round(w.points[2 * mouthCell], POINT_DECIMALS), y: round(w.points[2 * mouthCell + 1], POINT_DECIMALS) },
      }
    })
    .sort((a, b) => b.maxFlow - a.maxFlow || b.cells - a.cells)
    .slice(0, MAX_MAJOR_RIVERS)

  return {
    meta: {
      seed: w.seed,
      width: w.width,
      height: w.height,
      cellCount: n,
      seaLevel: round(w.seaLevel, 3),
      landCells,
      waterCells,
      oceanCells,
      lakeCells,
      landPct: pct(landCells, n),
      waterPct: pct(waterCells, n),
    },
    settings: w.settings,
    biomes,
    kingdoms,
    rivers: { total: w.rivers.length, major: majorRivers },
    markers: {
      total: w.markers.length,
      truncated: w.markers.length > MAX_LIST_ITEMS,
      items: w.markers.slice(0, MAX_LIST_ITEMS).map((m) => ({
        id: m.id,
        kind: m.kind,
        name: m.name,
        x: m.x,
        y: m.y,
        hasNotes: m.notes.trim().length > 0,
      })),
    },
    labels: {
      total: w.labels.length,
      truncated: w.labels.length > MAX_LIST_ITEMS,
      items: w.labels.slice(0, MAX_LIST_ITEMS).map((l) => ({
        id: l.id,
        text: l.text,
        x: l.x,
        y: l.y,
        size: l.size,
        rotation: l.rotation,
      })),
    },
  }
}

export interface PointSample {
  x: number
  y: number
  cell: number
  isLand: boolean
  isCoast: boolean
  onRiver: boolean
  elevation: number
  relAltitude: number
  biome: BiomeKey
  biomeName: string
  kingdom: { id: number; name: string } | null
  nearestMarkers: { id: number; kind: string; name: string; x: number; y: number; distance: number }[]
}

export function samplePoint(w: World, rawX: number, rawY: number): PointSample {
  const x = round(clamp(rawX, 0, w.width), POINT_DECIMALS)
  const y = round(clamp(rawY, 0, w.height), POINT_DECIMALS)
  const mesh = getMesh(w)
  const cell = mesh.delaunay.find(x, y)
  const land = isLand(w, cell)
  let isCoast = false
  if (land) {
    for (let k = mesh.nOff[cell]; k < mesh.nOff[cell + 1]; k++) {
      if (!isLand(w, mesh.nIdx[k])) {
        isCoast = true
        break
      }
    }
  }
  const onRiver = w.rivers.some((r) => r.cells.includes(cell))
  const sid = w.stateId[cell]
  const st = sid ? w.states.find((s) => s.id === sid) : undefined
  const biomeId = w.biome[cell] as Biome

  const nearestMarkers = w.markers
    .map((m) => ({ id: m.id, kind: m.kind, name: m.name, x: m.x, y: m.y, distance: round(Math.hypot(m.x - x, m.y - y), 1) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)

  return {
    x,
    y,
    cell,
    isLand: land,
    isCoast,
    onRiver,
    elevation: round(w.elevation[cell], 3),
    relAltitude: round(relAltitude(w.elevation[cell], w.seaLevel), 3),
    biome: biomeKeyOf(biomeId),
    biomeName: BIOME_NAMES[biomeId] ?? String(biomeId),
    kingdom: st ? { id: st.id, name: st.name } : null,
    nearestMarkers,
  }
}

export type TerrainFilter = 'any' | 'land' | 'water' | 'ocean' | 'lake' | 'coast' | 'mountain' | 'lowland' | 'river' | 'river_mouth'
export type Quadrant = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'center'

export interface LocationQuery {
  terrain?: TerrainFilter
  biome?: Biome
  /** Kingdom id; 0 matches unclaimed land. */
  kingdomId?: number
  /** Matches land cells on the border between these two kingdoms. */
  borderOfKingdoms?: [number, number]
  quadrant?: Quadrant
  bounds?: { minX: number; maxX: number; minY: number; maxY: number }
  minDistanceFromMarkers?: number
  minSpacing?: number
  limit?: number
}

export interface FoundLocation {
  x: number
  y: number
  cell: number
  biome: BiomeKey
  biomeName: string
  elevation: number
  relAltitude: number
  isCoast: boolean
  kingdomId: number
  kingdomName: string | null
}

export interface FindLocationsResult {
  totalMatches: number
  locations: FoundLocation[]
}

const MOUNTAIN_MIN_ALT = 0.55
const LOWLAND_MAX_ALT = 0.35

function inQuadrant(x: number, y: number, w: number, h: number, q: Quadrant): boolean {
  const hx = w / 2
  const hy = h / 2
  switch (q) {
    case 'nw':
      return x <= hx && y <= hy
    case 'ne':
      return x >= hx && y <= hy
    case 'sw':
      return x <= hx && y >= hy
    case 'se':
      return x >= hx && y >= hy
    case 'n':
      return y <= hy
    case 's':
      return y >= hy
    case 'w':
      return x <= hx
    case 'e':
      return x >= hx
    case 'center':
      return x >= w * 0.25 && x <= w * 0.75 && y >= h * 0.25 && y <= h * 0.75
  }
}

/** Finds up to `limit` well-spaced map coordinates matching semantic geographic criteria. */
export function findLocations(w: World, query: LocationQuery): FindLocationsResult {
  const mesh = getMesh(w)
  const n = mesh.n
  const terrain = query.terrain ?? 'land'
  const limit = Math.max(1, Math.min(20, query.limit ?? 5))

  // Precompute river cell membership / mouth flow only when needed.
  let riverCells: Set<number> | null = null
  let mouthFlow: Map<number, number> | null = null
  if (terrain === 'river') {
    riverCells = new Set<number>()
    for (const r of w.rivers) {
      for (const c of r.cells) if (isLand(w, c)) riverCells.add(c)
    }
  } else if (terrain === 'river_mouth') {
    mouthFlow = new Map<number, number>()
    for (const r of w.rivers) {
      if (r.cells.length < 2) continue
      const last = r.cells[r.cells.length - 1]
      const mouth = !isLand(w, last) ? r.cells[r.cells.length - 2] : last
      if (!isLand(w, mouth)) continue
      const flow = r.flow[r.flow.length - 1] ?? 1
      mouthFlow.set(mouth, Math.max(mouthFlow.get(mouth) ?? 0, flow))
    }
  }

  const isCoastCell = (i: number) => {
    if (!isLand(w, i)) return false
    for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) if (!isLand(w, mesh.nIdx[k])) return true
    return false
  }

  const isBorderPair = (i: number, a: number, b: number) => {
    const s = w.stateId[i]
    if (s !== a && s !== b) return false
    const other = s === a ? b : a
    for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) {
      const j = mesh.nIdx[k]
      if (isLand(w, j) && w.stateId[j] === other) return true
    }
    return false
  }

  const minMarkerDistSq = query.minDistanceFromMarkers ? query.minDistanceFromMarkers ** 2 : 0
  const candidates: { cell: number; score: number; coast: boolean }[] = []

  for (let i = 0; i < n; i++) {
    const land = isLand(w, i)
    const b = w.biome[i]
    const alt = relAltitude(w.elevation[i], w.seaLevel)
    let coast = false
    let score = 0

    switch (terrain) {
      case 'any':
        break
      case 'land':
        if (!land) continue
        break
      case 'water':
        if (land) continue
        break
      case 'ocean':
        if (b !== Biome.Ocean) continue
        break
      case 'lake':
        if (b !== Biome.Lake) continue
        break
      case 'coast':
        coast = isCoastCell(i)
        if (!coast) continue
        break
      case 'mountain':
        if (!land || alt < MOUNTAIN_MIN_ALT) continue
        score = alt
        break
      case 'lowland':
        if (!land || alt > LOWLAND_MAX_ALT) continue
        score = 1 - alt
        break
      case 'river':
        if (!riverCells!.has(i)) continue
        break
      case 'river_mouth': {
        const fl = mouthFlow!.get(i)
        if (fl === undefined) continue
        score = fl
        break
      }
    }

    if (query.biome !== undefined && b !== query.biome) continue
    if (query.kingdomId !== undefined && w.stateId[i] !== query.kingdomId) continue
    if (query.borderOfKingdoms && !isBorderPair(i, query.borderOfKingdoms[0], query.borderOfKingdoms[1])) continue

    const x = w.points[2 * i]
    const y = w.points[2 * i + 1]
    if (query.quadrant && !inQuadrant(x, y, w.width, w.height, query.quadrant)) continue
    if (query.bounds) {
      const { minX, maxX, minY, maxY } = query.bounds
      if (x < minX || x > maxX || y < minY || y > maxY) continue
    }
    if (minMarkerDistSq > 0) {
      let tooClose = false
      for (const m of w.markers) {
        if ((m.x - x) ** 2 + (m.y - y) ** 2 < minMarkerDistSq) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue
    }

    if (terrain !== 'coast') coast = isCoastCell(i)
    candidates.push({ cell: i, score, coast })
  }

  if (candidates.length === 0) return { totalMatches: 0, locations: [] }

  // Sort deterministically by score descending (then cell index) so the first pick is the strongest match.
  candidates.sort((a, b) => b.score - a.score || a.cell - b.cell)

  const defaultSpacing = Math.min(w.width, w.height) / (Math.sqrt(limit) * 2.5)
  const minSpacing = query.minSpacing ?? defaultSpacing
  const picked: typeof candidates = [candidates[0]]

  // Greedy farthest-point sampling among remaining candidates to spread results across the region.
  const minDistSq = new Float64Array(candidates.length)
  const px = (c: number) => w.points[2 * c]
  const py = (c: number) => w.points[2 * c + 1]
  const firstX = px(picked[0].cell)
  const firstY = py(picked[0].cell)
  for (let k = 0; k < candidates.length; k++) {
    const dx = px(candidates[k].cell) - firstX
    const dy = py(candidates[k].cell) - firstY
    minDistSq[k] = dx * dx + dy * dy
  }

  const spacingSq = minSpacing * minSpacing
  while (picked.length < limit) {
    let bestIdx = -1
    let bestVal = -1
    for (let k = 0; k < candidates.length; k++) {
      if (minDistSq[k] < spacingSq) continue
      // Blend spatial spread with score when scores exist.
      const val = minDistSq[k] * (1 + candidates[k].score)
      if (val > bestVal) {
        bestVal = val
        bestIdx = k
      }
    }
    if (bestIdx < 0) break
    const chosen = candidates[bestIdx]
    picked.push(chosen)
    const cx = px(chosen.cell)
    const cy = py(chosen.cell)
    for (let k = 0; k < candidates.length; k++) {
      const d2 = (px(candidates[k].cell) - cx) ** 2 + (py(candidates[k].cell) - cy) ** 2
      if (d2 < minDistSq[k]) minDistSq[k] = d2
    }
  }

  const stateNames = new Map(w.states.map((s) => [s.id, s.name]))
  return {
    totalMatches: candidates.length,
    locations: picked.map(({ cell, coast }) => {
      const b = w.biome[cell] as Biome
      const sid = w.stateId[cell]
      return {
        x: round(w.points[2 * cell], POINT_DECIMALS),
        y: round(w.points[2 * cell + 1], POINT_DECIMALS),
        cell,
        biome: biomeKeyOf(b),
        biomeName: BIOME_NAMES[b] ?? String(b),
        elevation: round(w.elevation[cell], 3),
        relAltitude: round(relAltitude(w.elevation[cell], w.seaLevel), 3),
        isCoast: coast,
        kingdomId: sid,
        kingdomName: sid ? (stateNames.get(sid) ?? null) : null,
      }
    }),
  }
}
