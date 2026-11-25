// Screen renderer: the static map is cached in an offscreen canvas and only rebuilt when the world,
// layers or pixel ratio change; each frame blits it with the current View, then runs live overlays.
// When zoomed in and idle, the visible part is re-drawn at screen resolution ("detail") so it stays sharp.
// Markers and labels are not in the cache: they are drawn every frame (see places.ts).
import type { Sel } from '../core/items'
import type { World } from '../core/world'
import { drawAnnotations } from './decor'
import { drawWorld, MAP_LAYERS, type Layers } from './draw'
import { fontsReady } from './fonts'
import { iconsReady, onIconLoad } from './iconImages'
import type { PlacesState } from './places'
import { framePad, HOME, transform, type View } from './view'

export type Overlay = (ctx: CanvasRenderingContext2D, view: View) => void

export interface Renderer {
  setWorld(w: World): void
  setLayers(l: Layers): void
  invalidate(): void
  draw(view?: View): void
  setSelection(s: Sel | null): void
  /** Draws one marker/label at a temporary position while it is dragged; cleared by the next setWorld. */
  setDrag(d: PlacesState['drag']): void
  /** Returns a function that removes the overlay. */
  addOverlay(fn: Overlay): () => void
  destroy(): void
}

// Browsers fail silently on very large canvases, so nothing we draw exceeds this per side.
export const MAX_CANVAS = 8192
// How long the view must stay still before the sharp re-draw (it costs a full drawWorld).
const DETAIL_DELAY_MS = 150

/** Draws the map at `scale` with a `pad` (map units) margin around it, for the frame. */
export function renderTo(w: World, scale: number, layers: Layers, canvas = document.createElement('canvas'), pad = 0, baseOnly = false) {
  canvas.width = Math.round((w.width + 2 * pad) * scale)
  canvas.height = Math.round((w.height + 2 * pad) * scale)
  drawWorld(canvas.getContext('2d')!, w, scale, layers, pad * scale, pad * scale, baseOnly)
  return canvas
}

/** World fields the cached map is drawn from; anything else (markers, labels...) doesn't need a rebuild. */
const MAP_KEYS = ['points', 'elevation', 'biome', 'rivers', 'stateId', 'states', 'seaLevel'] as const
const mapChanged = (a: World | null, b: World) => !a || MAP_KEYS.some((k) => a[k] !== b[k])

/** Renders the full sheet (map, markers, labels, grid, scale, compass, frame) at `scale` into a PNG. */
export async function renderPng(w: World, scale: number, layers: Layers): Promise<Blob> {
  const pad = framePad(w, layers.frame)
  if ((Math.max(w.width, w.height) + 2 * pad) * scale > MAX_CANVAS) throw new Error(`Imagem grande demais (máx. ${MAX_CANVAS}px por lado).`)
  await Promise.all([fontsReady(), iconsReady(w)])
  const c = renderTo(w, scale, layers, undefined, pad)
  const ctx = c.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, pad * scale, pad * scale)
  drawAnnotations(ctx, w, { layers, textReady: true, pad })
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png'),
  )
}

export function createRenderer(canvas: HTMLCanvasElement, initialLayers: Layers): Renderer {
  const ctx = canvas.getContext('2d')!
  const overlays = new Set<Overlay>()
  let destroyed = false
  let layers = initialLayers
  let world: World | null = null
  let cache: HTMLCanvasElement | null = null
  let cacheScale = 0
  let dirty = true
  let frame = 0
  let view: View = HOME
  // Sharp re-draw of the visible area; valid only for the exact transform/size it was drawn with.
  let detail: HTMLCanvasElement | null = null
  let detailKey = ''
  let detailTimer = 0
  let selection: Sel | null = null
  let drag: PlacesState['drag'] = null
  let textReady = false

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
  const scaleFor = (w: World) => Math.min(dpr(), MAX_CANVAS / Math.max(w.width, w.height))
  const screen = (w: World) => {
    const r = dpr()
    const cw = Math.round(canvas.clientWidth * r)
    const ch = Math.round(canvas.clientHeight * r)
    const t = transform(view, w.width, w.height, framePad(w, layers.frame), cw, ch, r)
    return { cw, ch, ...t, key: `${t.s},${t.ox},${t.oy},${cw},${ch}` }
  }

  function paint() {
    frame = 0
    if (!world) return
    const { cw, ch, s, ox, oy, key } = screen(world)
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const scale = scaleFor(world) // changes when the window moves to another monitor or the page zoom changes
    if (dirty || !cache || scale !== cacheScale) {
      cache = renderTo(world, scale, layers, cache ?? undefined)
      cacheScale = scale
      dirty = false
    }

    const sharp = detail !== null && detailKey === key
    if (sharp) ctx.drawImage(detail!, 0, 0) // already at screen resolution, drawn without a transform
    ctx.setTransform(s, 0, 0, s, ox, oy)
    if (!sharp) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(cache, 0, 0, world.width, world.height)
    }
    drawAnnotations(ctx, world, { layers, textReady, selection, drag, pad: framePad(world, layers.frame) })
    for (const fn of overlays) fn(ctx, view)
  }

  function renderDetail() {
    detailTimer = 0
    if (destroyed || !world || view.zoom <= 1) return
    const { cw, ch, s, ox, oy, key } = screen(world)
    detail ??= document.createElement('canvas')
    detail.width = cw
    detail.height = ch
    drawWorld(detail.getContext('2d')!, world, s, layers, ox, oy)
    detailKey = key
    schedule()
  }

  /** The view or map changed: drop the sharp image and re-arm the idle timer. */
  function viewChanged() {
    detailKey = ''
    clearTimeout(detailTimer)
    if (view.zoom > 1) detailTimer = window.setTimeout(renderDetail, DETAIL_DELAY_MS)
  }

  const schedule = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(paint)
  }
  const onResize = () => {
    viewChanged()
    schedule()
  }
  const resize = new ResizeObserver(onResize)
  resize.observe(canvas)
  // Moving to a monitor with another pixel ratio doesn't always resize the canvas; listen for it directly.
  let dprQuery: MediaQueryList | null = null
  const onDpr = () => {
    onResize()
    watchDpr()
  }
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprQuery.addEventListener('change', onDpr)
  }
  watchDpr()
  fontsReady().then(() => {
    textReady = true
    schedule()
  })
  const offIconLoad = onIconLoad(schedule) // uploaded icons decode after the first paint

  const invalidate = () => {
    dirty = true
    viewChanged()
    schedule()
  }

  return {
    setWorld(w) {
      const rebuild = mapChanged(world, w)
      world = w
      drag = null // the committed world now holds the dragged item's new position
      if (rebuild) invalidate()
      else schedule()
    },
    setLayers(l) {
      const rebuild = MAP_LAYERS.some((k) => l[k] !== layers[k])
      layers = l
      if (rebuild) invalidate()
      else {
        viewChanged() // the frame margin may have changed, so the sharp image's place on screen did too
        schedule()
      }
    },
    invalidate,
    draw(v) {
      if (v && (v.x !== view.x || v.y !== view.y || v.zoom !== view.zoom)) {
        view = { ...v }
        viewChanged()
      }
      schedule()
    },
    setSelection(s) {
      selection = s
      schedule()
    },
    setDrag(d) {
      drag = d
      schedule()
    },
    addOverlay(fn) {
      overlays.add(fn)
      schedule()
      return () => {
        overlays.delete(fn)
        schedule()
      }
    },
    destroy() {
      destroyed = true
      overlays.clear()
      cancelAnimationFrame(frame)
      clearTimeout(detailTimer)
      resize.disconnect()
      offIconLoad()
      dprQuery?.removeEventListener('change', onDpr)
    },
  }
}
