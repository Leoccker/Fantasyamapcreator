// Kingdoms: generation by cost-based expansion from capitals, and keeping stateId consistent after edits.
import { isWaterBiome, relAltitude } from './biomes'
import { MinHeap } from './heap'
import { clamp } from './math'
import { getMesh, type Mesh } from './mesh'
import { makeNamer } from './names'
import { rngFor } from './rng'
import { inBox, overlayBoxes } from './settings'
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
  const overlays = overlayBoxes(w)
  const inOverlay = (x: number, y: number) => inBox(x, y, overlays.compass) || inBox(x, y, overlays.scaleBar)
  const edgeMargin = Math.min(w.width, w.height) * 0.06

  capitals.forEach((seedCap, k) => {
    const id = k + 1
    const cells = cellsOf[k]
    const cx = cells.reduce((s, c) => s + px(c), 0) / cells.length
    const cy = cells.reduce((s, c) => s + py(c), 0) / cells.length

    // Re-seat the capital into the kingdom's heartland (interior lowland near the centroid, away from borders,
    // map edges, and corner overlays), rather than leaving it on the extreme Dijkstra expansion seed.
    const maxSpan = Math.max(spacing, ...cells.map((c) => Math.hypot(px(c) - cx, py(c) - cy)))
    let cap = seedCap
    let bestScore = Infinity
    for (const c of cells) {
      const x = px(c)
      const y = py(c)
      const dNorm = Math.hypot(x - cx, y - cy) / maxSpan
      const deg = mesh.nOff[c + 1] - mesh.nOff[c]
      let foreign = 0
      for (let e = mesh.nOff[c]; e < mesh.nOff[c + 1]; e++) {
        if (stateId[mesh.nIdx[e]] !== id) foreign++
      }
      const borderPenalty = deg > 0 ? (foreign / deg) * 0.85 : 0.85
      const edgePenalty = x < edgeMargin || x > w.width - edgeMargin || y < edgeMargin || y > w.height - edgeMargin ? 1.5 : 0
      const altPenalty = alt(c) >= CAPITAL_MAX_ALT ? 2 : 0
      const overlayPenalty = inOverlay(x, y) ? 10 : 0
      const score = dNorm + borderPenalty + edgePenalty + altPenalty + overlayPenalty
      if (score < bestScore) {
        bestScore = score
        cap = c
      }
    }

    const capitalId = nextId++
    const name = namer('state')
    const capPos = at(cap)
    states.push({ id, name, color: KINGDOM_COLORS[k % KINGDOM_COLORS.length], capital: capitalId, auto: true })
    markers.push({ id: capitalId, kind: 'capital', ...capPos, name: namer('city'), notes: '', auto: true })

    // Towns: random owned cells kept apart from each other, from the capital, and out of corner overlays.
    const placed = [cap]
    const towns = Math.min(2 + Math.floor(rng() * 3), Math.floor(cells.length / 25))
    for (let t = 0; t < 40 && placed.length <= towns; t++) {
      const c = cells[Math.floor(rng() * cells.length)]
      if (!inOverlay(px(c), py(c)) && placed.every((o) => dist(o, c) > 6 * spacing)) {
        placed.push(c)
        markers.push({ id: nextId++, kind: 'town', ...at(c), name: namer('city'), notes: '', auto: true })
      }
    }

    // Name label near the kingdom's centroid, shifted away from the capital marker if they would collide.
    const center = cells.reduce((b, c) => {
      const score = (i: number) => Math.hypot(px(i) - cx, py(i) - cy) + (inOverlay(px(i), py(i)) ? 1e6 : 0)
      return score(c) < score(b) ? c : b
    }, cap)
    const size = Math.round(Math.min(48, Math.max(16, 12 + 0.06 * Math.sqrt(cells.length) * spacing)))
    let lx = px(center)
    let ly = py(center)
    if (Math.hypot(lx - capPos.x, ly - capPos.y) < size * 1.1) {
      const shift = Math.round(size * 0.95)
      const upY = clamp(ly - shift, edgeMargin, w.height - edgeMargin)
      const downY = clamp(ly + shift, edgeMargin, w.height - edgeMargin)
      // Pick the direction that stays farther from overlays and inside the map.
      ly = !inOverlay(lx, upY) && Math.abs(upY - capPos.y) >= Math.abs(downY - capPos.y) ? upY : downY
    }
    labels.push({ id: nextId++, text: name, x: round(lx, POINT_DECIMALS), y: round(ly, POINT_DECIMALS), size, rotation: 0, auto: true })
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
      const best = neighborMajority(stateId, mesh, i)
      if (best) assigned.push([i, best])
      else rest.push(i)
    }
    if (!assigned.length) break // the rest has no kingdom nearby
    for (const [i, s] of assigned) stateId[i] = s // write after the round, so the result doesn't depend on order
    pending = rest
  }
}

type Neighbors = Pick<Mesh, 'nOff' | 'nIdx'>

/** The kingdom most of cell i's neighbors belong to (ties: lowest id), not counting unclaimed cells or `skip`; 0 if none. */
export function neighborMajority(stateId: Uint16Array, mesh: Neighbors, i: number, skip = 0): number {
  const votes = new Map<number, number>()
  for (let e = mesh.nOff[i]; e < mesh.nOff[i + 1]; e++) {
    const s = stateId[mesh.nIdx[e]]
    if (s && s !== skip) votes.set(s, (votes.get(s) ?? 0) + 1)
  }
  let best = 0
  let bestVotes = 0
  for (const [s, v] of votes) if (v > bestVotes || (v === bestVotes && s < best)) [best, bestVotes] = [s, v]
  return best
}

/**
 * Takes `cells` away from kingdom `state`, mutating the caller's stateId. A cell goes to the kingdom most of its
 * neighbors belong to, else becomes unclaimed if it touches unclaimed land or water (both have stateId 0), else
 * stays. In rounds, so the neighbor advances inward across `cells`. Returns the cells that changed.
 */
export function shrinkState(stateId: Uint16Array, mesh: Neighbors, cells: number[], state: number): number[] {
  if (!state) return []
  const changed: number[] = []
  let pending = cells.filter((i) => stateId[i] === state)
  while (pending.length) {
    const next: [number, number][] = []
    const rest: number[] = []
    for (const i of pending) {
      const to = neighborMajority(stateId, mesh, i, state) // another kingdom wins over unclaimed land
      let open = to !== 0
      for (let e = mesh.nOff[i]; !open && e < mesh.nOff[i + 1]; e++) open = stateId[mesh.nIdx[e]] === 0
      if (open) next.push([i, to])
      else rest.push(i)
    }
    if (!next.length) break // the rest is inland, with no border in reach
    for (const [i, to] of next) {
      stateId[i] = to
      changed.push(i)
    }
    pending = rest
  }
  return changed
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
