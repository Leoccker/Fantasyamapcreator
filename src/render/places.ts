// Markers and labels. They are drawn over the cached map every frame (and once more into PNG exports), so
// moving, renaming or deleting one never rebuilds the map, and text is sharp at any zoom.
import { DEFAULT_SHAPE_W, iconDef, SHAPE_PAINTS, type MarkerKind } from '../core/icons'
import { MARKER_SIZE, sameSel, type Sel } from '../core/items'
import type { Label, Marker, World } from '../core/world'
import type { Layers } from './draw'
import { MAP_FONT } from './fonts'
import { iconImage } from './iconImages'
import { INK, PAPER, SHAPE_COLORS } from './palette'
import { pathFromData } from './path'

const SELECTED = '#9c2f1f'
const LABEL_HALO = 0.22 // halo width as a fraction of the label size
const MARKER_TEXT = { big: 12, other: 10 } // marker name sizes, map units
const UPLOAD_SIZE = MARKER_SIZE * 1.25 // uploaded pictures have no outline, so they get a little more room

export interface PlacesState {
  layers: Layers
  /** False until the map font is loaded: text waits rather than flashing in the fallback font. */
  textReady: boolean
  selection?: Sel | null
  /** An item being dragged, drawn at this position instead of its stored one. */
  drag?: { sel: Sel; x: number; y: number } | null
}

export function drawPlaces(ctx: CanvasRenderingContext2D, w: World, o: PlacesState): void {
  const at = <T extends Marker | Label>(it: T, type: Sel['type']): T =>
    o.drag && sameSel(o.drag.sel, { type, id: it.id }) ? { ...it, x: o.drag.x, y: o.drag.y } : it
  const isSel = (type: Sel['type'], id: number) => sameSel(o.selection, { type, id })
  // Constant on-screen width for the selection ring, whatever the zoom.
  const px = 1 / ctx.getTransform().a

  ctx.save()
  ctx.lineJoin = 'round'
  if (o.layers.labels && o.textReady) {
    for (const raw of w.labels) {
      const l = at(raw, 'label')
      ctx.save()
      ctx.translate(l.x, l.y)
      ctx.rotate((l.rotation * Math.PI) / 180)
      ctx.font = `${l.size}px ${MAP_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      haloText(ctx, l.text, 0, 0, l.size * LABEL_HALO)
      if (isSel('label', l.id)) {
        const wd = ctx.measureText(l.text).width
        ctx.strokeStyle = SELECTED
        ctx.lineWidth = 1.5 * px
        ctx.strokeRect(-wd / 2 - 4, -l.size / 2 - 3, wd + 8, l.size + 6)
      }
      ctx.restore()
    }
  }
  if (o.layers.markers) {
    const uploads = new Map(w.icons.map((i) => [i.id, i.src]))
    for (const raw of w.markers) {
      const m = at(raw, 'marker')
      const img = m.icon ? iconImage(uploads.get(m.icon)) : null
      if (img) ctx.drawImage(img, m.x - UPLOAD_SIZE / 2, m.y - UPLOAD_SIZE / 2, UPLOAD_SIZE, UPLOAD_SIZE)
      else drawIcon(ctx, m.kind, m.x, m.y)
      if (o.textReady && m.name) {
        const def = iconDef(m.kind)
        ctx.font = `${def.italic ? 'italic ' : ''}${def.big ? MARKER_TEXT.big : MARKER_TEXT.other}px ${MAP_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        haloText(ctx, m.name, m.x, m.y + MARKER_SIZE * 0.6, 3)
      }
      if (isSel('marker', m.id)) {
        circle(ctx, m.x, m.y, MARKER_SIZE * 0.85)
        ctx.strokeStyle = SELECTED
        ctx.lineWidth = 2 * px
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/** Ink text with a paper halo, so it stays readable over hatching, forests and borders. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, halo: number) {
  ctx.strokeStyle = PAPER
  ctx.lineWidth = halo
  ctx.strokeText(text, x, y)
  ctx.fillStyle = INK
  ctx.fillText(text, x, y)
}

/** Starts a new path holding one circle. */
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

const shapePaths = new Map<string, Path2D>()

/** A catalog icon (see core/icons.ts), centered on (x, y), MARKER_SIZE map units across. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: MarkerKind, x: number, y: number): void {
  const r = MARKER_SIZE / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(r, r)
  for (const [d, style, w = DEFAULT_SHAPE_W] of iconDef(kind).shapes) {
    let p = shapePaths.get(d)
    if (!p) shapePaths.set(d, (p = pathFromData(d)))
    ctx.lineWidth = w / r
    for (const [letter, paint, color] of SHAPE_PAINTS) {
      if (!style.includes(letter)) continue
      if (paint === 'fill') {
        ctx.fillStyle = SHAPE_COLORS[color]
        ctx.fill(p)
      } else {
        ctx.strokeStyle = SHAPE_COLORS[color]
        ctx.stroke(p)
      }
    }
  }
  ctx.restore()
}
