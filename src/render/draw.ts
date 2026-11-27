// Parchment-style map drawing. drawWorld() is the single drawing path for screen cache and PNG export.
import type { LandBiome } from '../core/biomes'
import { borderEdges, coastEdges, getMesh, isLand, type Mesh } from '../core/mesh'
import { rngFor } from '../core/rng'
import type { World } from '../core/world'
import { chainEdges, smooth, type Polyline } from './coast'
import { REACH } from './dirtyRect'
import { BIOME_COLORS, INK, PAPER, RIVER, WATER_TINT } from './palette'
import { makePath, type PathSink } from './path'
import { drawSymbol, placeSymbols } from './symbols'

export const LAYERS = {
  paper: 'Textura do papel',
  hatching: 'Hachura do mar',
  biomes: 'Cores dos biomas',
  rivers: 'Rios',
  relief: 'Relevo e vegetação',
  tint: 'Cores dos reinos',
  borders: 'Fronteiras',
  markers: 'Marcadores',
  labels: 'Rótulos',
  grid: 'Grade',
  scale: 'Barra de escala',
  compass: 'Rosa dos ventos',
  frame: 'Moldura',
} as const
export type LayerId = keyof typeof LAYERS
export type Layers = Record<LayerId, boolean>
export const DEFAULT_LAYERS: Layers = {
  paper: true,
  hatching: true,
  biomes: true,
  rivers: true,
  relief: true,
  tint: false, // kingdom colors over the biome watercolor get muddy; off until asked for
  borders: true,
  markers: true,
  labels: true,
  grid: false,
  scale: true,
  compass: true,
  frame: true,
}

/** Layers drawn into the cached map; toggling the others (drawn every frame) needs no rebuild. */
export const MAP_LAYERS: LayerId[] = ['paper', 'hatching', 'biomes', 'rivers', 'relief', 'tint', 'borders']

const BORDER = 'rgba(110, 35, 25, 0.75)'

/**
 * Draws the map (everything but markers and labels, see places.ts) at `scale` device pixels per world unit,
 * shifted by (tx, ty) device pixels. The cache and PNG export use tx = ty = 0; the sharp zoomed view passes
 * the screen offset. `baseOnly` leaves out the line work (see drawLineWork), for the SVG export's raster base.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, world: World, scale: number, layers: Layers, tx = 0, ty = 0, baseOnly = false): void {
  const { width: W, height: H } = world
  const geo = geometry(world)
  const { coast, land } = geo
  // What this canvas shows, in map units: a stroke-preview patch or a zoomed view skips the work outside it.
  const [x0, y0, x1, y1] = [-tx / scale, -ty / scale, (ctx.canvas.width - tx) / scale, (ctx.canvas.height - ty) / scale]
  const near: Near = (x, y, m) => x >= x0 - m && y >= y0 - m && x <= x1 + m && y <= y1 + m

  ctx.save()
  setup(ctx, scale, tx, ty)
  clipToMap(ctx, world)

  // Paper, then a tint on all water (ocean + lakes).
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)
  if (layers.paper) drawPaperTexture(ctx, world, near)
  const water = new Path2D()
  water.rect(0, 0, W, H)
  water.addPath(land)
  ctx.fillStyle = WATER_TINT
  ctx.fill(water, 'evenodd')

  const layer = (draw: (l: CanvasRenderingContext2D) => void) => drawOnLayer(ctx, scale, tx, ty, draw)
  if (layers.hatching) layer((l) => drawHatching(l, linesNear(coast, near), land))
  if (layers.biomes) layer((l) => drawCellTint(l, world, land, scale, near, (i) => BIOME_COLORS[world.biome[i] as LandBiome], 0.6)) // water cells have no colour
  if (layers.tint && world.states.length) {
    const colors = new Map(world.states.map((st) => [st.id, st.color]))
    layer((l) => drawCellTint(l, world, land, scale, near, (i) => colors.get(world.stateId[i]), 0.25))
  }
  if (!baseOnly) drawLines(ctx, world, layers, geo, near)
  ctx.restore()
}

/** The line work alone (rivers, relief, borders, coast) in map units: the vector part of the SVG export. */
export function drawLineWork(ctx: CanvasRenderingContext2D, world: World, layers: Layers): void {
  ctx.save()
  setup(ctx, 1, 0, 0)
  clipToMap(ctx, world)
  drawLines(ctx, world, layers, geometry(world), everywhere)
  ctx.restore()
}

type Geometry = { mesh: ReturnType<typeof getMesh>; coast: Polyline[]; land: Path2D }

/** Whether a point is within `m` map units of what the canvas shows. */
type Near = (x: number, y: number, m: number) => boolean
const everywhere: Near = () => true

/**
 * The parts of `lines` near the canvas, with one more point on each side so the strokes there look the same; whole
 * lines when they are all near. Returned together, so they become one path (overlaps don't darken).
 */
function linesNear(lines: Polyline[], near: Near): Polyline[] {
  const out: Polyline[] = []
  for (const line of lines) {
    const { pts, closed } = line
    const n = pts.length / 2
    const isNear = (k: number) => near(pts[2 * k], pts[2 * k + 1], REACH)
    let far = 0
    while (far < n && isNear(far)) far++
    if (far === n) {
      out.push(line)
      continue
    }
    // Walk from a far point (around the loop if closed), so no near run is split at the line's start.
    const first = closed ? far : 0
    const steps = closed ? n + 1 : n
    let run: number[] = []
    let prev = -1
    for (let s = 0; s < steps; s++) {
      const k = (first + s) % n
      if (isNear(k)) {
        if (!run.length && prev >= 0) run.push(pts[2 * prev], pts[2 * prev + 1])
        run.push(pts[2 * k], pts[2 * k + 1])
      } else if (run.length) {
        run.push(pts[2 * k], pts[2 * k + 1])
        out.push({ pts: run, closed: false })
        run = []
      }
      prev = k
    }
    if (run.length) out.push({ pts: run, closed: false })
  }
  return out
}

function geometry(world: World): Geometry {
  const mesh = getMesh(world)
  const coast = chainEdges(coastEdges(world, mesh)).map((l) => smooth(l))
  return { mesh, coast, land: pathOf(coast) } // fill land with 'evenodd': lakes become holes
}

/** Clips to the map, so strokes near the border (e.g. hatching) never spill outside it on a zoomed view. */
function clipToMap(ctx: CanvasRenderingContext2D, world: World) {
  ctx.beginPath()
  ctx.rect(0, 0, world.width, world.height)
  ctx.clip()
}

function drawLines(ctx: CanvasRenderingContext2D, world: World, layers: Layers, { mesh, land }: Geometry, near: Near) {
  if (layers.rivers) drawRivers(ctx, world, near)
  if (layers.relief) {
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.9
    // All placed (one symbol can push out the next), only the ones that show drawn.
    for (const s of placeSymbols(world, mesh)) if (near(s.x, s.y, 2 * s.size)) drawSymbol(ctx, s)
  }
  if (layers.borders && world.states.length) {
    ctx.save()
    ctx.setLineDash([6, 4]) // map units, so dashes scale with the map like everything else
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 1.5
    ctx.stroke(pathOf(chainEdges(borderEdges(world, mesh)).map((l) => smooth(l))))
    ctx.restore()
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.6
  ctx.stroke(land)
}

function setup(ctx: CanvasRenderingContext2D, scale: number, tx: number, ty: number) {
  ctx.translate(tx, ty)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

/** Appends flat x,y points to a path. */
function addPoly(path: PathSink, pts: ArrayLike<number>, closed: boolean) {
  path.moveTo(pts[0], pts[1])
  for (let k = 2; k < pts.length; k += 2) path.lineTo(pts[k], pts[k + 1])
  if (closed) path.closePath()
}

function pathOf(lines: Polyline[]): Path2D {
  return makePath((p) => {
    for (const { pts, closed } of lines) addPoly(p, pts, closed)
  })
}

// Reused by every layer: a new map-sized canvas per layer per frame made brush strokes stutter (GPU memory churn).
// It only grows, so the small stroke-preview patches and full renders don't keep resizing it.
let scratch: HTMLCanvasElement | null = null
// Bigger than any screen map (a large PNG export): a throwaway canvas, so the shared one doesn't keep that memory.
const SCRATCH_MAX_PX = 4096 * 4096

/** Draws into a same-size transparent canvas (so composite tricks don't touch the map), then blits it. */
function drawOnLayer(ctx: CanvasRenderingContext2D, scale: number, tx: number, ty: number, draw: (l: CanvasRenderingContext2D) => void) {
  const { width: w, height: h } = ctx.canvas
  const c = w * h > SCRATCH_MAX_PX ? document.createElement('canvas') : (scratch ??= document.createElement('canvas'))
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w)
    c.height = Math.max(c.height, h)
  }
  const l = c.getContext('2d')!
  l.clearRect(0, 0, w, h)
  l.save()
  l.beginPath()
  l.rect(0, 0, w, h)
  l.clip() // the blur filter would otherwise run over the whole grown canvas
  setup(l, scale, tx, ty)
  draw(l)
  l.restore()
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(c, 0, 0, w, h, 0, 0, w, h)
  ctx.restore()
}

/** Seeded speckles, blotches and a vignette, so the same map always gets the same paper. */
function drawPaperTexture(ctx: CanvasRenderingContext2D, world: World, near: Near) {
  const { width: W, height: H } = world
  const rng = rngFor(world.seed, 'paper')
  for (let i = 0; i < 14; i++) {
    const x = rng() * W
    const y = rng() * H
    const r = 60 + rng() * 220
    const alpha = 0.04 + rng() * 0.05 // drawn even when skipped, so the next blotches stay the same
    if (!near(x, y, r)) continue
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(150, 110, 60, ${alpha})`)
    g.addColorStop(1, 'rgba(150, 110, 60, 0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
  }
  const dots = Math.round((W * H) / 300)
  for (let i = 0; i < dots; i++) {
    const dark = rng() < 0.5
    const [x, y, w, h] = [rng() * W, rng() * H, 1 + rng(), 1 + rng()]
    if (!near(x, y, 2)) continue
    ctx.fillStyle = dark ? 'rgba(90, 60, 30, 0.07)' : 'rgba(255, 250, 235, 0.10)'
    ctx.fillRect(x, y, w, h)
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2)
  v.addColorStop(0, 'rgba(110, 70, 30, 0)')
  v.addColorStop(1, 'rgba(110, 70, 30, 0.28)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

/** Ripple lines parallel to the coast: wide ink stroke, then erase all but its outer rim, from far to near. */
function drawHatching(l: CanvasRenderingContext2D, coast: Polyline[], land: Path2D) {
  const path = pathOf(coast)
  const rings = 5
  const gap = 5
  for (let k = rings; k >= 1; k--) {
    l.globalCompositeOperation = 'source-over'
    l.strokeStyle = `rgba(59, 42, 26, ${0.55 - k * 0.08})`
    l.lineWidth = 2 * k * gap
    l.stroke(path)
    l.globalCompositeOperation = 'destination-out'
    l.strokeStyle = '#000' // erasing uses the source alpha, so it must be opaque
    l.lineWidth = 2 * k * gap - 1.2
    l.stroke(path)
  }
  l.fillStyle = '#000'
  l.fill(land, 'evenodd') // still destination-out: keep ripples on the water side only
  l.globalCompositeOperation = 'source-over'
}

// One Path2D per cell, built once per mesh: a brush stroke redraws the tints every frame, and adding ~50k
// points one call at a time cost ~25 ms per tint layer, while addPath() of a ready cell is ~1 ms in all.
const cellPathMemo = new WeakMap<Mesh, (Path2D | null)[]>()
function cellPaths(mesh: Mesh): (Path2D | null)[] {
  let paths = cellPathMemo.get(mesh)
  if (!paths) {
    paths = mesh.polys.map((p) => {
      if (!p) return null
      const path = new Path2D()
      addPoly(path, p, true)
      return path
    })
    cellPathMemo.set(mesh, paths)
  }
  return paths
}

/** Soft watercolor tints per land cell (biomes, kingdoms), blurred and then clipped to the land. */
function drawCellTint(
  l: CanvasRenderingContext2D,
  world: World,
  land: Path2D,
  scale: number,
  near: Near,
  colorOf: (cell: number) => string | undefined,
  alpha: number,
) {
  const mesh = getMesh(world)
  const cells = cellPaths(mesh)
  const byColor = new Map<string, Path2D>()
  for (let i = 0; i < mesh.n; i++) {
    const color = colorOf(i)
    const p = cells[i]
    if (!color || !p || !isLand(world, i) || !near(world.points[2 * i], world.points[2 * i + 1], REACH)) continue
    let path = byColor.get(color)
    if (!path) byColor.set(color, (path = new Path2D()))
    path.addPath(p)
  }
  l.save()
  l.filter = `blur(${3 * scale}px)` // filter radius is in device pixels, not affected by the transform
  l.globalAlpha = alpha
  for (const [color, path] of byColor) {
    l.fillStyle = color
    l.fill(path)
    l.strokeStyle = color // closes hairline gaps between cells of the same color
    l.lineWidth = 1
    l.stroke(path)
  }
  l.restore()
  l.globalCompositeOperation = 'destination-in'
  l.fill(land, 'evenodd')
  l.globalCompositeOperation = 'source-over'
}

/** Rivers as smooth curves through cell centers, thicker downstream. */
function drawRivers(ctx: CanvasRenderingContext2D, world: World, near: Near) {
  const maxFlow = Math.max(1, ...world.rivers.map((r) => r.flow[r.flow.length - 1]))
  ctx.strokeStyle = RIVER
  const pt = (c: number) => [world.points[2 * c], world.points[2 * c + 1]]
  for (const r of world.rivers) {
    const pts = r.cells.map(pt)
    const n = pts.length
    const end = r.cells[n - 1]
    // Stop at the shore (halfway to the water cell), not at the water cell's center.
    if (!isLand(world, end)) pts[n - 1] = [(pts[n - 2][0] + pts[n - 1][0]) / 2, (pts[n - 2][1] + pts[n - 1][1]) / 2]
    for (let k = 1; k < n; k++) {
      const [ax, ay] = k === 1 ? pts[0] : mid(pts[k - 1], pts[k - 2])
      const [bx, by] = k === n - 1 ? pts[k] : mid(pts[k], pts[k - 1])
      if (!near(pts[k - 1][0], pts[k - 1][1], REACH)) continue
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.quadraticCurveTo(pts[k - 1][0], pts[k - 1][1], bx, by)
      ctx.lineWidth = 0.6 + 2.4 * Math.sqrt(r.flow[k] / maxFlow)
      ctx.stroke()
    }
  }
}

const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
