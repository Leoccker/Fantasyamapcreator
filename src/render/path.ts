// A Path2D can't say what it holds, so the SVG export couldn't read the coast, grid or icons back from one.
// Paths the SVG export needs are made here: they remember how to rebuild themselves as SVG path data, which
// only runs when an export asks for it.

export type PathSink = Pick<CanvasPath, 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'arc' | 'rect' | 'closePath'>

const sources = new WeakMap<object, () => string>()

export function makePath(build: (p: PathSink) => void): Path2D {
  const p = new Path2D()
  build(p)
  sources.set(p, () => {
    const d = new PathData()
    build(d)
    return d.d
  })
  return p
}

export function pathFromData(d: string): Path2D {
  const p = new Path2D(d)
  sources.set(p, () => d)
  return p
}

/** SVG path data for a path made above; undefined for a plain Path2D. */
export const pathDataOf = (p: object): string | undefined => sources.get(p)?.()

/** Numbers in SVG output: 2 decimals is far below a device pixel at any sane export size. */
export const fmt = (v: number) => String(Math.round(v * 100) / 100)

const TAU = Math.PI * 2

/** Builds SVG path data with the canvas path calls. */
export class PathData implements PathSink {
  d = ''
  private open = false // a subpath has a current point (canvas arc() draws a line to its start then)

  moveTo(x: number, y: number) {
    this.d += `M${fmt(x)} ${fmt(y)}`
    this.open = true
  }
  lineTo(x: number, y: number) {
    this.d += `${this.open ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`
    this.open = true
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    if (!this.open) this.moveTo(cx, cy)
    this.d += `Q${fmt(cx)} ${fmt(cy)} ${fmt(x)} ${fmt(y)}`
  }
  rect(x: number, y: number, w: number, h: number) {
    this.d += `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`
    this.open = true
  }
  closePath() {
    if (this.open) this.d += 'Z'
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false) {
    const at = (a: number) => `${fmt(cx + Math.cos(a) * r)} ${fmt(cy + Math.sin(a) * r)}`
    this.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
    let sweep = ccw ? a0 - a1 : a1 - a0
    const sw = ccw ? 0 : 1
    if (sweep >= TAU) {
      // A full circle can't be one SVG arc (same start and end): two halves.
      this.d += `A${fmt(r)} ${fmt(r)} 0 1 ${sw} ${at(a0 + (ccw ? -1 : 1) * Math.PI)}A${fmt(r)} ${fmt(r)} 0 1 ${sw} ${at(a0)}`
      return
    }
    sweep = ((sweep % TAU) + TAU) % TAU
    this.d += `A${fmt(r)} ${fmt(r)} 0 ${sweep > Math.PI ? 1 : 0} ${sw} ${at(a1)}`
  }
}
