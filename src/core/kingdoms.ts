// Kingdoms: generation by cost-based expansion from capitals, and keeping stateId consistent after edits.
import { isWaterBiome, relAltitude } from './biomes'
import { MinHeap } from './heap'
import { getMesh, type Mesh } from './mesh'
import { makeNamer } from './names'
import { rngFor } from './rng'
import { POINT_DECIMALS, round, type Label, type Marker, type State, type World } from './world'

/** Muted inks that read well on parchment; reused in order. */
export const KINGDOM_COLORS = [
  '#b5523b', '#3f6f8f', '#6b8e3a', '#8a5a9e', '#c08a2b', '#2f7f74',
  '#a33f6a', '#5c6bc0', '#7a6a3a', '#3a7d44', '#b06b2b', '#4f5d75',
]

const MOUNTAIN_COST = 6 // extra step cost at the highest peaks: borders tend to follow ranges
const CAPITAL_MAX_ALT = 0.5 // capitals sit in lowlands
const CAPITAL_TRIES = 20

/**
 * Replaces the kingdoms with `count` new ones, plus their generated capitals, towns and name labels.
 * Hand-made markers/labels (no `auto`) are kept. Terrain fields are reused untouched.
 * `variant` 0 is what generate() uses (reproducible from the seed); the "Gerar reinos" button passes others.
 */
export function generateKingdoms(w: World, count: number, variant = 0): World {
  const mesh = getMesh(w)
  const n = mesh.n
  const stream = variant ? `states:${variant}` : 'states'
  const rng = rngFor(w.seed, stream)
  const keptMarkers = w.markers.filter((m) => !m.auto)
  const keptLabels = w.labels.filter((l) => !l.auto)
  const namer = makeNamer(rngFor(w.seed, stream + '/names'), [...keptMarkers.map((m) => m.name), ...keptLabels.map((l) => l.text)])
  const px = (i: number) => w.points[2 * i]
  const py = (i: number) => w.points[2 * i + 1]
  const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b))
  const land = (i: number) => !isWaterBiome(w.biome[i])
  const alt = (i: number) => relAltitude(w.elevation[i], w.seaLevel)

  // 1. Capitals in lowlands, spread out.
  const candidates: number[] = []
  for (let i = 0; i < n; i++) if (land(i) && alt(i) < CAPITAL_MAX_ALT) candidates.push(i)
  const capitals: number[] = []
  for (let k = 0; k < Math.min(count, candidates.length); k++) {
    const c = farthestCandidate(candidates, capitals, rng, dist)
    if (c >= 0) capitals.push(c)
  }

  // 2. Multi-source Dijkstra over land; mountains cost more, water is impassable.
  const stateId = new Uint16Array(n)
  const cost = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  const heap = new MinHeap()
  capitals.forEach((c, k) => {
    stateId[c] = k + 1
    cost[c] = 0
    heap.push(c, 0)
  })
  while (heap.size) {
    const i = heap.pop()
    if (done[i]) continue
    done[i] = 1
    for (let e = mesh.nOff[i]; e < mesh.nOff[i + 1]; e++) {
      const j = mesh.nIdx[e]
      if (done[j] || !land(j)) continue
      const c = cost[i] + dist(i, j) * (1 + MOUNTAIN_COST * alt(j) ** 2)
      if (c < cost[j]) {
        cost[j] = c
        stateId[j] = stateId[i]
        heap.push(j, c)
      }
    }
  }

  // 3. States and their generated places: capital city, a few towns, a name label.
  let nextId = w.nextId
  const states: State[] = []
  const markers: Marker[] = [...keptMarkers]
  const labels: Label[] = [...keptLabels]
  const cellsOf: number[][] = capitals.map(() => [])
  for (let i = 0; i < n; i++) if (stateId[i]) cellsOf[stateId[i] - 1].push(i)
  const spacing = Math.sqrt((w.width * w.height) / n) // average cell size
  const at = (i: number) => ({ x: round(px(i), POINT_DECIMALS), y: round(py(i), POINT_DECIMALS) })

  capitals.forEach((cap, k) => {
    const id = k + 1
    const cells = cellsOf[k]
    const capitalId = nextId++
    const name = namer('state')
    states.push({ id, name, color: KINGDOM_COLORS[k % KINGDOM_COLORS.length], capital: capitalId, auto: true })
    markers.push({ id: capitalId, kind: 'city', ...at(cap), name: namer('city'), notes: '', auto: true })

    // Towns: random owned cells kept apart from each other and from the capital.
    const placed = [cap]
    const towns = Math.min(2 + Math.floor(rng() * 3), Math.floor(cells.length / 25))
    for (let t = 0; t < 30 && placed.length <= towns; t++) {
      const c = cells[Math.floor(rng() * cells.length)]
      if (placed.every((o) => dist(o, c) > 6 * spacing)) {
        placed.push(c)
        markers.push({ id: nextId++, kind: 'town', ...at(c), name: namer('city'), notes: '', auto: true })
      }
    }

    // Name label at the owned cell nearest the kingdom's centroid.
    const cx = cells.reduce((s, c) => s + px(c), 0) / cells.length
    const cy = cells.reduce((s, c) => s + py(c), 0) / cells.length
    const center = cells.reduce((b, c) => (Math.hypot(px(c) - cx, py(c) - cy) < Math.hypot(px(b) - cx, py(b) - cy) ? c : b), cap)
    const size = Math.round(Math.min(48, Math.max(16, 12 + 0.06 * Math.sqrt(cells.length) * spacing)))
    labels.push({ id: nextId++, text: name, ...at(center), size, rotation: 0, auto: true })
  })

  return { ...w, stateId, states, markers, labels, nextId }
}

/**
 * Samples a few candidate cells and returns the one farthest from every chosen capital
 * (just one sample for the first capital), or -1 if every sample was already taken.
 */
function farthestCandidate(candidates: number[], chosen: number[], rng: () => number, dist: (a: number, b: number) => number): number {
  const nearest = (c: number) => chosen.reduce((m, o) => Math.min(m, dist(o, c)), Infinity)
  let best = -1
  let bestD = -1
  for (let t = 0; t < (chosen.length ? CAPITAL_TRIES : 1); t++) {
    const c = candidates[Math.floor(rng() * candidates.length)]
    const d = nearest(c)
    if (d > bestD && !chosen.includes(c)) {
      best = c
      bestD = d
    }
  }
  return best
}

/**
 * Keeps kingdoms consistent with the terrain, mutating the caller's own copy of stateId:
 * water cells lose their kingdom; with `prev`, cells that were water and are now land join the kingdom most
 * of their neighbors belong to (ties: lowest id), in rounds so a new island fills in from its shore.
 * Land that was already unclaimed stays unclaimed (it may have been erased on purpose).
 */
export function settleStates(stateId: Uint16Array, biome: Uint8Array, prev?: { biome: Uint8Array; mesh: Mesh }): void {
  for (let i = 0; i < stateId.length; i++) if (isWaterBiome(biome[i])) stateId[i] = 0
  if (!prev) return
  const { mesh } = prev
  let pending: number[] = []
  for (let i = 0; i < stateId.length; i++) if (isWaterBiome(prev.biome[i]) && !isWaterBiome(biome[i])) pending.push(i)
  while (pending.length) {
    const assigned: [number, number][] = []
    const rest: number[] = []
    for (const i of pending) {
      const votes = new Map<number, number>()
      for (let e = mesh.nOff[i]; e < mesh.nOff[i + 1]; e++) {
        const s = stateId[mesh.nIdx[e]]
        if (s) votes.set(s, (votes.get(s) ?? 0) + 1)
      }
      let best = 0
      let bestVotes = 0
      for (const [s, v] of votes) if (v > bestVotes || (v === bestVotes && s < best)) [best, bestVotes] = [s, v]
      if (best) assigned.push([i, best])
      else rest.push(i)
    }
    if (!assigned.length) break // the rest has no kingdom nearby
    for (const [i, s] of assigned) stateId[i] = s // write after the round, so the result doesn't depend on order
    pending = rest
  }
}

/** Where to look for a kingdom: its capital marker, or the middle of its cells. */
export function stateCenter(w: World, id: number): [number, number] | null {
  const st = w.states.find((s) => s.id === id)
  const cap = st?.capital != null ? w.markers.find((m) => m.id === st.capital) : undefined
  if (cap) return [cap.x, cap.y]
  let sx = 0
  let sy = 0
  let k = 0
  for (let i = 0; i < w.stateId.length; i++) {
    if (w.stateId[i] !== id) continue
    sx += w.points[2 * i]
    sy += w.points[2 * i + 1]
    k++
  }
  return k ? [sx / k, sy / k] : null
}
