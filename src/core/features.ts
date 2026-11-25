// Climate, biomes, lakes and rivers, all derived from elevation (+ seed for the moisture noise).
// Brushes re-run deriveFeatures() after an elevation edit; hand-painted biomes (biomeOverride) are applied here,
// so generate, import and edits all agree.
import { createNoise2D } from 'simplex-noise'
import { Biome, classify, NO_BIOME, relAltitude } from './biomes'
import { MinHeap } from './heap'
import { getMesh } from './mesh'
import { rngFor } from './rng'
import type { River, World } from './world'

export type TerrainInput = Pick<World, 'seed' | 'width' | 'height' | 'seaLevel' | 'points' | 'elevation'> &
  Partial<Pick<World, 'biomeOverride'>>

export interface Features {
  biome: Uint8Array
  rivers: River[]
}

const EPS = 1e-5 // minimum drop per cell in filled depressions, so every land cell drains somewhere
const LAKE_MIN_DEPTH = 0.008
const LAKE_MIN_CELLS = 3

export function deriveFeatures(t: TerrainInput): Features {
  const { nOff, nIdx, n, delaunay } = getMesh(t)
  const { elevation: elev, seaLevel } = t
  const neighbors = (i: number) => nIdx.subarray(nOff[i], nOff[i + 1])

  // 1. Ocean = below-sea water connected to the map edge. Enclosed below-sea basins become lakes later.
  const ocean = new Uint8Array(n)
  const queue: number[] = []
  for (const i of delaunay.hull) {
    if (elev[i] < seaLevel && !ocean[i]) {
      ocean[i] = 1
      queue.push(i)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    for (const j of neighbors(queue[q])) {
      if (!ocean[j] && elev[j] < seaLevel) {
        ocean[j] = 1
        queue.push(j)
      }
    }
  }
  if (queue.length === 0) for (const i of delaunay.hull) ocean[i] = 1 // degenerate: no sea at all

  // 2. Distance to the ocean in cells (BFS), used for moisture.
  const dist = new Float32Array(n).fill(Infinity)
  const bfs: number[] = []
  for (let i = 0; i < n; i++) {
    if (ocean[i]) {
      dist[i] = 0
      bfs.push(i)
    }
  }
  for (let q = 0; q < bfs.length; q++) {
    const i = bfs[q]
    for (const j of neighbors(i)) {
      if (dist[j] === Infinity) {
        dist[j] = dist[i] + 1
        bfs.push(j)
      }
    }
  }

  // 3. Priority-flood from the ocean: fills depressions and gives each land cell a downstream neighbor.
  const filled = Float64Array.from(elev)
  const down = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const heap = new MinHeap()
  for (let i = 0; i < n; i++) {
    if (ocean[i]) {
      done[i] = 1
      heap.push(i, elev[i])
    }
  }
  const order: number[] = [] // land cells from lowest to highest filled level
  while (heap.size) {
    const i = heap.pop()
    if (!ocean[i]) order.push(i)
    for (const j of neighbors(i)) {
      if (done[j]) continue
      done[j] = 1
      filled[j] = Math.max(elev[j], filled[i] + EPS)
      down[j] = i
      heap.push(j, filled[j])
    }
  }

  // 4. Lakes: deep enough filled depressions, ignoring tiny puddles.
  const lake = new Uint8Array(n)
  const seen = new Uint8Array(n)
  for (let s = 0; s < n; s++) {
    if (seen[s] || ocean[s] || filled[s] - elev[s] < LAKE_MIN_DEPTH) continue
    const comp = [s]
    seen[s] = 1
    for (let q = 0; q < comp.length; q++) {
      for (const j of neighbors(comp[q])) {
        if (!seen[j] && !ocean[j] && filled[j] - elev[j] >= LAKE_MIN_DEPTH) {
          seen[j] = 1
          comp.push(j)
        }
      }
    }
    if (comp.length >= LAKE_MIN_CELLS) for (const c of comp) lake[c] = 1
  }

  // 5. Climate and biomes.
  const noise = createNoise2D(rngFor(t.seed, 'moisture'))
  const biome = new Uint8Array(n)
  const moisture = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (ocean[i]) continue // Biome.Ocean is 0
    if (lake[i]) {
      biome[i] = Biome.Lake
      continue
    }
    const u = t.points[2 * i] / t.width
    const v = t.points[2 * i + 1] / t.height
    const relAlt = relAltitude(elev[i], seaLevel)
    const wet = (noise(u * 3, v * 3) * 0.6 + noise(u * 7, v * 7) * 0.4 + 1) / 2
    moisture[i] = clamp01(0.55 * wet + 0.45 * Math.exp(-dist[i] / 10))
    // North (top) is cold, south is warm; altitude cools.
    const temp = clamp01(0.1 + 0.85 * v - 0.55 * relAlt + noise(u * 2 + 50, v * 2) * 0.08)
    // A painted biome wins on land; water from the relief (handled above) always wins over paint.
    const painted = t.biomeOverride?.[i] ?? NO_BIOME
    biome[i] = painted !== NO_BIOME ? painted : classify(temp, moisture[i], relAlt)
  }

  // 6. Flow accumulation, highest cells first; rain is heavier where it's wet.
  const flow = new Float64Array(n)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    flow[i] += 0.5 + moisture[i]
    if (down[i] >= 0) flow[down[i]] += flow[i]
  }

  return { biome, rivers: traceRivers(n, order.length, ocean, lake, down, flow) }
}

/**
 * Rivers run from source to mouth; the last cell is where it ends (ocean, lake, or the river it joins).
 * Each river follows the biggest upstream branch, so main stems stay in one piece and tributaries join them.
 */
function traceRivers(n: number, landCount: number, ocean: Uint8Array, lake: Uint8Array, down: Int32Array, flow: Float64Array): River[] {
  const threshold = Math.max(12, landCount * 0.006)
  const isRiver = (i: number) => !ocean[i] && !lake[i] && flow[i] >= threshold
  const ups: number[][] = Array.from({ length: n }, () => [])
  const starts: [number, number][] = [] // [first river cell, where it ends]
  for (let i = 0; i < n; i++) {
    if (!isRiver(i)) continue
    const d = down[i]
    if (d >= 0 && isRiver(d)) ups[d].push(i)
    else if (d >= 0) starts.push([i, d]) // mouth into ocean or lake
  }
  // Biggest rivers first, so output order is stable and meaningful.
  starts.sort((a, b) => flow[b[0]] - flow[a[0]] || a[0] - b[0])

  const rivers: River[] = []
  // starts grows as tributaries are found; walk it as a queue.
  for (let s = 0; s < starts.length; s++) {
    const [mouth, end] = starts[s]
    const path = [end, mouth]
    for (let cur = mouth; ups[cur].length; ) {
      const [main, ...rest] = [...ups[cur]].sort((a, b) => flow[b] - flow[a] || a - b)
      for (const r of rest) starts.push([r, cur])
      path.push(main)
      cur = main
    }
    if (path.length < 3) continue
    path.reverse()
    const flows = path.map((c) => flow[c])
    // A water cell's flow is the whole basin's; the river's width at its mouth is the last land cell's.
    if (ocean[end] || lake[end]) flows[flows.length - 1] = flows[flows.length - 2]
    rivers.push({ cells: path, flow: flows.map(round2) })
  }
  return rivers
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const round2 = (x: number) => Math.round(x * 100) / 100
