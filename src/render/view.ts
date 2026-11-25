// Pan/zoom math, pure. One definition of "where the map is on screen", shared by painting and mouse input.
// `pad` is the frame margin around the W x H map, in map units: the whole sheet (map + margin) is fitted to the
// canvas, while world coordinates stay map coordinates ((0, 0) is still the map's top-left corner).

export interface View {
  /** Pan in CSS pixels, added after centering. */
  x: number
  y: number
  /** Multiplies the scale that fits the whole sheet in the canvas. */
  zoom: number
}

export const HOME: View = { x: 0, y: 0, zoom: 1 }
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 8

/** Frame margin in map units; the single place that decides it. 0 when the frame layer is off. */
export const framePad = (w: { width: number; height: number }, frameOn: boolean) => (frameOn ? Math.round(Math.min(w.width, w.height) * 0.06) : 0)

/**
 * World -> screen transform: screen = o + s * world. cw/ch are in the same pixel unit as the result;
 * r converts the view's CSS-pixel pan into that unit (devicePixelRatio for the canvas, 1 for CSS).
 * The frame is symmetric around the map, so it only changes the fit, not the centering.
 */
export function transform(v: View, W: number, H: number, pad: number, cw: number, ch: number, r = 1) {
  const fit = Math.min(cw / (W + 2 * pad), ch / (H + 2 * pad))
  return {
    s: fit * v.zoom,
    ox: (cw - W * fit) / 2 + v.x * r,
    oy: (ch - H * fit) / 2 + v.y * r,
  }
}

/** CSS pixel (relative to the canvas) -> world coordinates. */
export function screenToWorld(v: View, W: number, H: number, pad: number, cssW: number, cssH: number, px: number, py: number): [number, number] {
  const { s, ox, oy } = transform(v, W, H, pad, cssW, cssH)
  return [(px - ox) / s, (py - oy) / s]
}

/** Zooms by `factor` keeping the world point under (px, py) fixed on screen. */
export function zoomAt(v: View, W: number, H: number, pad: number, cssW: number, cssH: number, px: number, py: number, factor: number): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
  const k = zoom / v.zoom
  const { ox: bx, oy: by } = transform(HOME, W, H, pad, cssW, cssH) // centering offset, without pan
  return { zoom, x: px - bx - (px - bx - v.x) * k, y: py - by - (py - by - v.y) * k }
}

/** Pans (and zooms in to at least `minZoom`) so world point (wx, wy) lands in the middle of the canvas. */
export function centerOn(v: View, W: number, H: number, pad: number, cssW: number, cssH: number, wx: number, wy: number, minZoom = 2): View {
  const zoom = Math.max(v.zoom, minZoom)
  const { s, ox, oy } = transform({ x: 0, y: 0, zoom }, W, H, pad, cssW, cssH)
  return { zoom, x: cssW / 2 - (ox + s * wx), y: cssH / 2 - (oy + s * wy) }
}
