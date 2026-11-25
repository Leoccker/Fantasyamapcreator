// Runtime-only geometry derived from World.points. Never persisted.
import { Delaunay, type Voronoi } from 'd3-delaunay'
import { isWaterBiome } from './biomes'
import type { World } from './world'

export interface Mesh {
  n: number
  delaunay: Delaunay<Delaunay.Point>
  voronoi: Voronoi<Delaunay.Point>
  /** CSR neighbors: neighbors of i are nIdx[nOff[i] .. nOff[i + 1]). */
  nOff: Int32Array
  nIdx: Int32Array
  /** Flat x,y ring per cell (not closed), clipped to the map box. null if degenerate. */
  polys: (Float32Array | null)[]
}

export function buildMesh(points: Float32Array, w: number, h: number): Mesh {
  const n = points.length / 2
  const delaunay = new Delaunay(Float64Array.from(points))
  const voronoi = delaunay.voronoi([0, 0, w, h])

  const nOff = new Int32Array(n + 1)
  const idx: number[] = []
  const polys: (Float32Array | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    for (const j of delaunay.neighbors(i)) idx.push(j)
    nOff[i + 1] = idx.length
    const ring = voronoi.cellPolygon(i)
    polys[i] = ring ? Float32Array.from(ring.slice(0, -1).flat()) : null
  }
  return { n, delaunay, voronoi, nOff, nIdx: Int32Array.from(idx), polys }
}

// Keyed on the points array: edits that only change `elevation` keep the mesh valid.
// Brushes/undo must reuse the same `points` array; a copy silently rebuilds the mesh.
const cache = new WeakMap<Float32Array, Mesh>()

export function getMesh(world: Pick<World, 'points' | 'width' | 'height'>): Mesh {
  let m = cache.get(world.points)
  if (!m) cache.set(world.points, (m = buildMesh(world.points, world.width, world.height)))
  return m
}

/** Land vs water (ocean or lake) comes from the biome, so lake shores count as coast too. */
export const isLand = (world: Pick<World, 'biome'>, i: number) => !isWaterBiome(world.biome[i])

/**
 * Flat x1,y1,x2,y2 per Voronoi edge separating a land cell from a water cell (ocean or lake).
 * Each Delaunay halfedge pair e/o joins cells triangles[e] and triangles[o]; the Voronoi edge between
 * them runs between the circumcenters of their two triangles. Hull halfedges (o === -1) are skipped.
 */
export function coastEdges(world: Pick<World, 'biome'>, mesh: Mesh): Float32Array {
  const { triangles, halfedges } = mesh.delaunay
  const cc = mesh.voronoi.circumcenters
  const out: number[] = []
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e]
    if (o < e) continue // hull edge, or pair already visited
    if (isLand(world, triangles[e]) === isLand(world, triangles[o])) continue
    const t1 = (e / 3) | 0
    const t2 = (o / 3) | 0
    out.push(cc[2 * t1], cc[2 * t1 + 1], cc[2 * t2], cc[2 * t2 + 1])
  }
  return Float32Array.from(out)
}
