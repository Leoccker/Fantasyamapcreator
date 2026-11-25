// Drawing. drawWorld() is the single drawing path, shared by the screen cache and PNG export.
import { coastEdges, getMesh, isLand, type Mesh } from './mesh'
import type { World } from './world'

export interface View {
  x: number
  y: number
  zoom: number
}

export interface RenderOpts {
  scale: number
  layers: { paper: boolean; terrain: boolean }
}

export const PAPER = '#f1e4c3'
const WATER = '#cfd9d2'
const LAND = '#e9d9a6'
const INK = '#3b2a1a'
const MAX_CANVAS = 8192

// shortcut: flat paper color, no texture/vignette; add in phase 2 with the parchment style.
export function drawWorld(ctx: CanvasRenderingContext2D, world: World, mesh: Mesh, opts: RenderOpts): void {
  ctx.save()
  ctx.scale(opts.scale, opts.scale)
  if (opts.layers.paper) {
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, world.width, world.height)
  }
  if (opts.layers.terrain) {
    // Water is one background rect; only land cells are drawn.
    ctx.fillStyle = WATER
    ctx.fillRect(0, 0, world.width, world.height)

    ctx.beginPath()
    for (let i = 0; i < mesh.n; i++) {
      const p = mesh.polys[i]
      if (!p || !isLand(world, i)) continue
      ctx.moveTo(p[0], p[1])
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1])
      ctx.closePath()
    }
    ctx.fillStyle = LAND
    ctx.fill()
    // Same-color stroke hides antialiasing seams between adjacent land cells.
    ctx.strokeStyle = LAND
    ctx.lineWidth = 0.6
    ctx.stroke()

    // shortcut: raw straight Voronoi edges; chain + smooth them in phase 2 (hatching needs polylines).
    const e = coastEdges(world, mesh)
    ctx.beginPath()
    for (let k = 0; k < e.length; k += 4) {
      ctx.moveTo(e[k], e[k + 1])
      ctx.lineTo(e[k + 2], e[k + 3])
    }
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  ctx.restore()
}

export type Overlay = (ctx: CanvasRenderingContext2D, view: View) => void

export interface Renderer {
  setWorld(w: World): void
  invalidate(): void
  draw(view?: View): void
  addOverlay(fn: Overlay): void
  exportPng(scale: number): Promise<Blob>
}

/**
 * Screen renderer: the static map is cached in an offscreen canvas and only rebuilt on invalidate();
 * each frame blits the cache fitted to the canvas (letterboxed), then runs live overlays (brush cursor etc.).
 */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')!
  const layers = { paper: true, terrain: true }
  const overlays: Overlay[] = []
  let world: World | null = null
  let cache: HTMLCanvasElement | null = null
  let cacheScale = 0
  let dirty = true
  let frame = 0
  let view: View = { x: 0, y: 0, zoom: 1 }

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
  // Browsers fail silently on very large canvases, so the cache never exceeds MAX_CANVAS per side.
  const scaleFor = (w: World) => Math.min(dpr(), MAX_CANVAS / Math.max(w.width, w.height))

  function renderTo(w: World, scale: number, canvas = document.createElement('canvas')) {
    canvas.width = Math.round(w.width * scale)
    canvas.height = Math.round(w.height * scale)
    drawWorld(canvas.getContext('2d')!, w, getMesh(w), { scale, layers })
    return canvas
  }

  function paint() {
    frame = 0
    const r = dpr()
    const cw = Math.round(canvas.clientWidth * r)
    const ch = Math.round(canvas.clientHeight * r)
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    if (!world) return
    const scale = scaleFor(world) // changes when the window moves to another monitor or the page zoom changes
    if (dirty || !cache || scale !== cacheScale) {
      cache = renderTo(world, scale, cache ?? undefined)
      cacheScale = scale
      dirty = false
    }

    // Fit the world into the canvas, then apply the user's view (pan/zoom, used from phase 3).
    const fit = Math.min(cw / world.width, ch / world.height)
    const s = fit * view.zoom
    const ox = (cw - world.width * fit) / 2 + view.x * r
    const oy = (ch - world.height * fit) / 2 + view.y * r
    ctx.setTransform(s, 0, 0, s, ox, oy)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cache, 0, 0, world.width, world.height)
    for (const fn of overlays) fn(ctx, view)
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint)
  }
  new ResizeObserver(schedule).observe(canvas)
  // Moving to a monitor with another pixel ratio doesn't always resize the canvas; listen for it directly.
  const watchDpr = () =>
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        schedule()
        watchDpr()
      },
      { once: true },
    )
  watchDpr()

  return {
    setWorld(w) {
      world = w
      dirty = true
      schedule()
    },
    invalidate() {
      dirty = true
      schedule()
    },
    draw(v) {
      if (v) view = v
      schedule()
    },
    addOverlay(fn) {
      overlays.push(fn)
      schedule()
    },
    exportPng(scale) {
      const w = world
      if (!w) return Promise.reject(new Error('Nenhum mapa para exportar.'))
      const c = renderTo(w, scale)
      return new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem grande demais para exportar.'))), 'image/png'),
      )
    },
  }
}
