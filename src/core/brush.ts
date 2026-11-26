// Brush editing, pure. A stroke edits private copies (a BrushSession) and only commitSession() builds a new
// World, so committed Worlds are never mutated and undo can keep plain references to them.
import { isWaterBiome, type Biome } from './biomes'
import { deriveFeatures } from './features'
import { withoutAuto } from './items'
import { clamp01 } from './math'
import { settleStates } from './kingdoms'
import { getMesh, type Mesh } from './mesh'
import { ELEVATION_DECIMALS, round, type MarkerKind, type World } from './world'

export type BrushTool = 'raise' | 'lower' | 'smooth' | 'biome' | 'kingdom'

export interface Brush {
  /** Radius in world units (map pixels). */
  radius: number
  /** 0..1 */
  strength: number
  /** Biome painted by the 'biome' tool. */
  biome: Biome
  /** Kingdom painted by the 'kingdom' tool; 0 erases. */
  state: number
  /** Kind placed by the marker tool. */
  marker: MarkerKind
  /** Uploaded icon (World.icons id) placed by the marker tool instead of the kind's own. */
  icon?: number
}

export interface BrushSession {
  base: World
  tool: BrushTool
  elevation: Float32Array
  biome: Uint8Array
  override: Uint8Array
  stateId: Uint16Array
  touched: Set<number>
  /** Where the last dab landed; the next dabs continue from here at a fixed spacing. */
  last: [number, number] | null
}

const RAISE_PER_DAB = 0.04

export function startSession(base: World, tool: BrushTool): BrushSession {
  return {
    base,
    tool,
    elevation: Float32Array.from(base.elevation),
    biome: Uint8Array.from(base.biome),
    override: Uint8Array.from(base.biomeOverride),
    stateId: Uint16Array.from(base.stateId),
    touched: new Set(),
    last: null,
  }
}

/** Smoothstep falloff: 1 at the center, 0 at the edge. */
export function falloff(d: number, r: number): number {
  if (d >= r) return 0
  const t = 1 - d / r
  return t * t * (3 - 2 * t)
}

/** Cells whose center is within r of (x, y), with their falloff weight. Walks neighbors out from the nearest cell. */
export function cellsInRadius(mesh: Mesh, points: Float32Array, x: number, y: number, r: number): [cell: number, weight: number][] {
  const start = mesh.delaunay.find(x, y)
  const seen = new Set([start])
  const queue = [start]
  const out: [number, number][] = []
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const d = Math.hypot(points[2 * i] - x, points[2 * i + 1] - y)
    if (d < r) out.push([i, falloff(d, r)])
    else if (i !== start) continue // outside: don't expand further (the start cell always expands)
    for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) {
      const j = mesh.nIdx[k]
      if (!seen.has(j)) {
        seen.add(j)
        queue.push(j)
      }
    }
  }
  return out
}

/** Moves the brush to (x, y), dabbing every radius/4 along the way so the result doesn't depend on event rate. */
export function strokeTo(s: BrushSession, x: number, y: number, b: Brush): void {
  if (!s.last) {
    dab(s, x, y, b)
    s.last = [x, y]
    return
  }
  const [lx, ly] = s.last
  const dist = Math.hypot(x - lx, y - ly)
  const step = Math.max(b.radius / 4, 1)
  const n = Math.floor(dist / step)
  for (let k = 1; k <= n; k++) dab(s, lx + ((x - lx) * k * step) / dist, ly + ((y - ly) * k * step) / dist, b)
  if (n > 0) s.last = [lx + ((x - lx) * n * step) / dist, ly + ((y - ly) * n * step) / dist]
}

function dab(s: BrushSession, x: number, y: number, b: Brush): void {
  const mesh = getMesh(s.base)
  const hits = cellsInRadius(mesh, s.base.points, x, y, b.radius)
  const e = s.elevation
  if (s.tool === 'kingdom') {
    // A kingdom that no longer exists (after "Gerar reinos" or undo) would make the saved file unloadable.
    if (b.state !== 0 && !s.base.states.some((st) => st.id === b.state)) return
    for (const [i] of hits) {
      // Land-only, and only real changes: repainting a cell with its own kingdom is not an edit.
      if (isWaterBiome(s.base.biome[i]) || s.stateId[i] === b.state) continue
      s.stateId[i] = b.state
      s.touched.add(i)
    }
    return
  }
  if (s.tool === 'biome') {
    for (const [i] of hits) {
      if (isWaterBiome(s.base.biome[i])) continue // paint is land-only
      s.biome[i] = b.biome
      s.override[i] = b.biome
      s.touched.add(i)
    }
    return
  }
  if (s.tool === 'smooth') {
    // Read every neighbor average before writing, so the result doesn't depend on cell order.
    const next = hits.map(([i, w]) => {
      let sum = 0
      for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) sum += e[mesh.nIdx[k]]
      const avg = sum / (mesh.nOff[i + 1] - mesh.nOff[i])
      return e[i] + (avg - e[i]) * b.strength * w
    })
    hits.forEach(([i], k) => {
      e[i] = clamp01(next[k])
      s.touched.add(i)
    })
    return
  }
  const sign = s.tool === 'raise' ? 1 : -1
  for (const [i, w] of hits) {
    e[i] = clamp01(e[i] + sign * b.strength * RAISE_PER_DAB * w)
    s.touched.add(i)
  }
}

/** Builds the edited World (same points array, so the mesh cache still hits), or null if nothing changed. */
export function commitSession(s: BrushSession): World | null {
  if (s.touched.size === 0) return null
  const { base } = s
  if (s.tool === 'biome') return { ...base, biome: s.biome, biomeOverride: s.override }
  if (s.tool === 'kingdom') {
    // The kingdoms that gained or lost cells are now hand-edited.
    const affected = new Set<number>()
    for (const i of s.touched) affected.add(base.stateId[i]).add(s.stateId[i])
    const states = base.states.map((st) => (affected.has(st.id) && st.auto ? withoutAuto(st) : st))
    return { ...base, stateId: s.stateId, states }
  }
  const elevation = s.elevation.map((v) => round(v, ELEVATION_DECIMALS))
  const features = deriveFeatures({ ...base, elevation })
  const stateId = Uint16Array.from(base.stateId)
  settleStates(stateId, features.biome, { biome: base.biome, mesh: getMesh(base) })
  return { ...base, elevation, ...features, stateId }
}

