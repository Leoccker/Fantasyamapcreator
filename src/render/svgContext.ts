// A stand-in for CanvasRenderingContext2D that writes SVG instead of pixels, so the line work, markers,
// labels and decorations reach the SVG export through the very same drawing code as the screen and the PNG.
// It implements only the calls that code makes (no gradients, filters or compositing: those effects stay in
// the export's raster base). Transforms and clips become nested <g> groups, so no matrix math is needed.
import { fmt, PathData, pathDataOf } from './path'

interface DrawState {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  lineJoin: CanvasLineJoin
  lineCap: CanvasLineCap
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  dash: number[]
  /** Accumulated scale, for getTransform().a. */
  k: number
  /** <g> elements opened since the matching save(). */
  groups: number
}

/** Text for XML content and attributes. Control characters are illegal in XML, so they go too. */
export const esc = (s: string) =>
  s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const ANCHOR: Partial<Record<CanvasTextAlign, string>> = { center: 'middle', right: 'end', end: 'end' }
const BASELINE: Partial<Record<CanvasTextBaseline, string>> = { middle: 'central', top: 'text-before-edge', bottom: 'text-after-edge', hanging: 'hanging' }

export class SvgContext implements DrawState {
  fillStyle = '#000'
  strokeStyle = '#000'
  lineWidth = 1
  globalAlpha = 1
  lineJoin: CanvasLineJoin = 'miter'
  lineCap: CanvasLineCap = 'butt'
  font = '10px sans-serif'
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  dash: number[] = []
  k: number
  groups = 0

  private out: string[] = []
  private defs: string[] = []
  private stack: DrawState[] = []
  private path = new PathData()

  /** `scale`: device pixels per map unit that getTransform() reports (hairlines are drawn this thin). */
  constructor(scale = 1) {
    this.k = scale
  }

  /** The recorded elements, with any group left open closed. */
  body(): string {
    return this.out.join('\n') + '</g>'.repeat(this.groups + this.stack.reduce((n, s) => n + s.groups, 0))
  }
  /** <clipPath> definitions the body refers to. */
  defsXml(): string {
    return this.defs.join('\n')
  }

  save() {
    const { fillStyle, strokeStyle, lineWidth, globalAlpha, lineJoin, lineCap, font, textAlign, textBaseline, dash, k, groups } = this
    this.stack.push({ fillStyle, strokeStyle, lineWidth, globalAlpha, lineJoin, lineCap, font, textAlign, textBaseline, dash, k, groups })
    this.groups = 0
  }
  restore() {
    const s = this.stack.pop()
    if (!s) return
    this.out.push('</g>'.repeat(this.groups))
    Object.assign(this, s)
  }

  translate(x: number, y: number) {
    if (x || y) this.group(`transform="translate(${fmt(x)} ${fmt(y)})"`)
  }
  scale(x: number, y: number) {
    if (x === 1 && y === 1) return
    this.group(`transform="scale(${+x.toFixed(6)} ${+y.toFixed(6)})"`)
    this.k *= x
  }
  rotate(a: number) {
    if (a) this.group(`transform="rotate(${fmt((a * 180) / Math.PI)})"`)
  }
  getTransform() {
    return { a: this.k } as DOMMatrix
  }
  setLineDash(d: number[]) {
    this.dash = [...d]
  }

  beginPath() {
    this.path = new PathData()
  }
  moveTo(x: number, y: number) {
    this.path.moveTo(x, y)
  }
  lineTo(x: number, y: number) {
    this.path.lineTo(x, y)
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.path.quadraticCurveTo(cx, cy, x, y)
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw?: boolean) {
    this.path.arc(cx, cy, r, a0, a1, ccw)
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.rect(x, y, w, h)
  }
  closePath() {
    this.path.closePath()
  }

  clip() {
    const id = `clip${this.defs.length}`
    this.defs.push(`<clipPath id="${id}"><path d="${this.path.d}"/></clipPath>`)
    this.group(`clip-path="url(#${id})"`)
  }

  fill(a?: Path2D | CanvasFillRule, b?: CanvasFillRule) {
    const [d, rule] = typeof a === 'object' ? [this.dataOf(a), b] : [this.path.d, a]
    this.out.push(`<path d="${d}"${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.paint('fill', this.fillStyle)}/>`)
  }
  stroke(p?: Path2D) {
    this.out.push(`<path d="${p ? this.dataOf(p) : this.path.d}" fill="none"${this.strokeAttrs()}/>`)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect ${this.box(x, y, w, h)}${this.paint('fill', this.fillStyle)}/>`)
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect ${this.box(x, y, w, h)} fill="none"${this.strokeAttrs()}/>`)
  }
  fillText(t: string, x: number, y: number) {
    this.out.push(`<text x="${fmt(x)}" y="${fmt(y)}"${this.textAttrs()}${this.paint('fill', this.fillStyle)}>${esc(t)}</text>`)
  }
  strokeText(t: string, x: number, y: number) {
    this.out.push(`<text x="${fmt(x)}" y="${fmt(y)}"${this.textAttrs()} fill="none"${this.strokeAttrs()}>${esc(t)}</text>`)
  }
  drawImage(img: HTMLImageElement, x: number, y: number, w: number, h: number) {
    // shortcut: each marker repeats its icon's data URL; use <defs> + <use> if maps with many uploaded-icon markers get heavy.
    this.out.push(`<image xlink:href="${esc(img.src)}" ${this.box(x, y, w, h)}${this.globalAlpha < 1 ? ` opacity="${this.globalAlpha}"` : ''}/>`)
  }

  private group(attrs: string) {
    this.out.push(`<g ${attrs}>`)
    this.groups++
  }
  private dataOf(p: Path2D): string {
    const d = pathDataOf(p)
    if (d === undefined) throw new Error('SVG: caminho sem dados (crie-o com makePath).')
    return d
  }
  private box(x: number, y: number, w: number, h: number) {
    return `x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}"`
  }
  /** A colour as fill/stroke plus opacity: rgba() is split, since some SVG editors don't read it. */
  private paint(what: 'fill' | 'stroke', color: string): string {
    const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(color)
    const alpha = (m ? Number(m[4]) : 1) * this.globalAlpha
    const c = m ? `rgb(${m[1]},${m[2]},${m[3]})` : color
    return ` ${what}="${esc(c)}"${alpha < 1 ? ` ${what}-opacity="${+alpha.toFixed(3)}"` : ''}`
  }
  private strokeAttrs(): string {
    let a = `${this.paint('stroke', this.strokeStyle)} stroke-width="${+this.lineWidth.toFixed(4)}"`
    if (this.lineJoin !== 'miter') a += ` stroke-linejoin="${this.lineJoin}"`
    if (this.lineCap !== 'butt') a += ` stroke-linecap="${this.lineCap}"`
    if (this.dash.length) a += ` stroke-dasharray="${this.dash.map(fmt).join(' ')}"`
    return a
  }
  private textAttrs(): string {
    const m = /^(italic )?([\d.]+)px (.+)$/.exec(this.font)
    let a = m ? ` font-size="${fmt(Number(m[2]))}" font-family="${esc(m[3])}"${m[1] ? ' font-style="italic"' : ''}` : ''
    if (ANCHOR[this.textAlign]) a += ` text-anchor="${ANCHOR[this.textAlign]}"`
    if (BASELINE[this.textBaseline]) a += ` dominant-baseline="${BASELINE[this.textBaseline]}"`
    return a
  }
}

/** The recorder, typed for the drawing functions. Only the calls listed above may be used on it. */
export const asCanvas = (s: SvgContext) => s as unknown as CanvasRenderingContext2D
