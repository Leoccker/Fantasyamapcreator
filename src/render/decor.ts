// Map furniture drawn over the cached map every frame (and once more into PNG exports): grid, markers and
// labels, scale bar, compass and frame. All in map units, so it scales with the map; vector, so it stays sharp
// at any zoom; and changing a setting or toggling a layer never rebuilds the map.
import { gridCellUnits, gridSegments } from '../core/grid'
import { scaleBarSpec } from '../core/scale'
import type { Corner } from '../core/settings'
import type { World } from '../core/world'
import { MAP_FONT } from './fonts'
import { INK, PAPER } from './palette'
import { makePath } from './path'
import { drawPlaces, haloText, type PlacesState } from './places'

export interface DecorState extends PlacesState {
  /** Frame margin in map units (see view.framePad). */
  pad: number
}

const GRID_ALPHA = 0.35
const MIN_GRID_PX = 5 // cells smaller than this on screen would only draw a gray blur
const BACKDROP_ALPHA = 0.8 // paper behind the scale bar and compass, so they read over forests and hatching
const MOUNT_TINT = 'rgba(110, 70, 30, 0.10)' // frame margin, a touch darker than the map, like a mount
// Sizes below are in "units": a thousandth of the map's shorter side, so decorations scale with the map.
const MARGIN = 30 // from the map edge to the scale bar / compass
const SCALE_MAX_FRAC = 0.18 // the scale bar is at most this share of the map width
const COMPASS_R = 42
const COMPASS_LABEL = 24 // room above the compass for the "N"
const STACK_GAP = 60 // shift of the compass when it shares a corner with the scale bar

export function drawAnnotations(ctx: CanvasRenderingContext2D, w: World, o: DecorState): void {
  if (o.layers.grid) drawGrid(ctx, w)
  drawPlaces(ctx, w, o)
  const unit = Math.min(w.width, w.height) / 1000
  if (o.layers.scale) drawScaleBar(ctx, w, unit, o.textReady)
  if (o.layers.compass) drawCompass(ctx, w, unit, o.textReady, o.layers.scale && w.settings.scaleCorner === w.settings.compassCorner)
  if (o.layers.frame && o.pad > 0) drawFrame(ctx, w, o.pad, o.textReady)
}

// The grid path only changes with its settings and the map size: build it once per combination.
let gridMemo: { key: string; path: Path2D } | null = null

function drawGrid(ctx: CanvasRenderingContext2D, w: World) {
  const { size } = gridCellUnits(w.settings, w.width, w.height)
  const a = ctx.getTransform().a // device pixels per map unit
  if (size * a < MIN_GRID_PX) return
  const key = `${w.settings.gridType}|${size}|${w.width}|${w.height}`
  if (gridMemo?.key !== key) {
    const s = gridSegments(w.settings.gridType, size, w.width, w.height)
    const path = makePath((p) => {
      for (let i = 0; i < s.length; i += 4) {
        p.moveTo(s[i], s[i + 1])
        p.lineTo(s[i + 2], s[i + 3])
      }
    })
    gridMemo = { key, path }
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w.width, w.height)
  ctx.clip()
  ctx.strokeStyle = INK
  ctx.globalAlpha = GRID_ALPHA
  ctx.lineWidth = 1 / a // one device pixel at any zoom, and in the PNG
  ctx.stroke(gridMemo.path)
  ctx.restore()
}

/** Top-left of a bw x bh box in `corner`, `m` in from the map edges. */
function anchor(corner: Corner, W: number, H: number, bw: number, bh: number, m: number): [number, number] {
  return [corner[1] === 'l' ? m : W - m - bw, corner[0] === 't' ? m : H - m - bh]
}

function drawScaleBar(ctx: CanvasRenderingContext2D, w: World, k: number, textReady: boolean) {
  const { units, label } = scaleBarSpec(w.settings.kmPerUnit, w.width * SCALE_MAX_FRAC)
  if (!units) return
  const barH = 6 * k
  const font = 16 * k
  const head = font * 1.4 // room for the label above the bar
  const [x, y0] = anchor(w.settings.scaleCorner, w.width, w.height, units, barH + head, MARGIN * k)
  const y = y0 + head
  ctx.save()
  ctx.globalAlpha = BACKDROP_ALPHA
  ctx.fillStyle = PAPER
  ctx.fillRect(x - 8 * k, y0 - 4 * k, units + 16 * k, barH + head + 10 * k)
  ctx.globalAlpha = 1
  const parts = 4
  for (let i = 0; i < parts; i++) {
    ctx.fillStyle = i % 2 ? PAPER : INK
    ctx.fillRect(x + (i * units) / parts, y, units / parts, barH)
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2 * k
  ctx.strokeRect(x, y, units, barH)
  if (textReady) {
    ctx.font = `${font}px ${MAP_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    haloText(ctx, label, x + units / 2, y - 4 * k, 3 * k)
  }
  ctx.restore()
}

function drawCompass(ctx: CanvasRenderingContext2D, w: World, k: number, textReady: boolean, besideScale: boolean) {
  const r = COMPASS_R * k
  const box = 2 * r + COMPASS_LABEL * k
  let [x, y] = anchor(w.settings.compassCorner, w.width, w.height, box, box, MARGIN * k)
  // Sharing a corner with the scale bar: sit just inside it, towards the middle of the map.
  if (besideScale) y += (w.settings.compassCorner[0] === 't' ? 1 : -1) * STACK_GAP * k
  const cx = x + box / 2
  const cy = y + COMPASS_LABEL * k + r
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2 * k
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2)
  ctx.globalAlpha = BACKDROP_ALPHA
  ctx.fillStyle = PAPER
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.stroke()
  // Eight points: long ones on N/E/S/W. Each point is two halves, one ink and one paper, like an engraving.
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2
    const len = i % 2 ? r * 0.55 : r
    const side = len * 0.2
    for (const [dir, fill] of [[1, INK], [-1, PAPER]] as const) {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len)
      ctx.lineTo(cx + Math.cos(a + dir * Math.PI / 2) * side, cy + Math.sin(a + dir * Math.PI / 2) * side)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.stroke()
    }
  }
  if (textReady) {
    ctx.font = `${20 * k}px ${MAP_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    haloText(ctx, 'N', cx, cy - r - 2 * k, 3 * k)
  }
  ctx.restore()
}

/** A parchment margin around the map with a double rule, corner diamonds and the title in the top band. */
function drawFrame(ctx: CanvasRenderingContext2D, w: World, p: number, textReady: boolean) {
  const { width: W, height: H } = w
  const rect = (inset: number) => [-p + inset, -p + inset, W + 2 * (p - inset), H + 2 * (p - inset)] as const
  ctx.save()
  // Paper only on the margin ring (evenodd cuts the map out), so the map underneath is never covered.
  const ring = makePath((r) => {
    r.rect(-p, -p, W + 2 * p, H + 2 * p)
    r.rect(0, 0, W, H)
  })
  ctx.fillStyle = PAPER
  ctx.fill(ring, 'evenodd')
  ctx.fillStyle = MOUNT_TINT
  ctx.fill(ring, 'evenodd')

  ctx.strokeStyle = INK
  ctx.lineWidth = p * 0.05
  ctx.strokeRect(...rect(p * 0.12))
  ctx.lineWidth = p * 0.015
  ctx.strokeRect(...rect(p * 0.22))
  ctx.lineWidth = p * 0.03
  ctx.strokeRect(0, 0, W, H) // neatline at the map edge

  // Corner diamonds on the outer rule.
  const d = p * 0.16
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx < 0 ? -p * 0.88 : W + p * 0.88, sy < 0 ? -p * 0.88 : H + p * 0.88]))
  for (const [x, y] of corners) {
    ctx.beginPath()
    ctx.moveTo(x, y - d)
    ctx.lineTo(x + d, y)
    ctx.lineTo(x, y + d)
    ctx.lineTo(x - d, y)
    ctx.closePath()
    ctx.fillStyle = INK
    ctx.fill()
  }

  const title = w.settings.title.trim() || w.seed
  if (textReady && title) {
    // Between the thin rule (-0.78p) and the map; it may run over the rules only if very long.
    ctx.font = `${p * 0.42}px ${MAP_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    haloText(ctx, title, W / 2, -p * 0.4, p * 0.08)
  }
  ctx.restore()
}
