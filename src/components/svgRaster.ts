import { ImportMapError, landFromRgba, maskLayout, type LandMask } from '../core/importMask'

const MAX_FILE = 5_000_000

/**
 * Reads an SVG file as a land mask for a map whose long side is `longSide`. The SVG is only drawn through an <img> (which runs no scripts and loads
 * nothing from outside) onto a canvas, and only its pixels are kept; it is never put into the page.
 */
export async function svgToLandMask(file: File, longSide: number): Promise<LandMask> {
  if (file.size > MAX_FILE) throw new ImportMapError('SVG grande demais (máx. 5 MB).')
  // Parsed only to read and fix its size; a DOMParser document is inert (no scripts, no loads).
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml')
  const root = doc.documentElement
  if (doc.getElementsByTagName('parsererror').length || root.localName !== 'svg') throw new ImportMapError('O arquivo não é um SVG válido.')
  const size = svgSize(root)
  if (!size) throw new ImportMapError('O SVG não informa seu tamanho (faltam viewBox, width e height).')

  const layout = maskLayout(size.w, size.h, longSide)
  const { draw } = layout
  // Explicit size so every browser draws it the same (some give an SVG without width/height no size at all);
  // a viewBox makes the drawing scale to that size instead of being cropped.
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
  root.setAttribute('width', String(draw.w))
  root.setAttribute('height', String(draw.h))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new ImportMapError('Não foi possível desenhar o SVG.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = layout.gw
    canvas.height = layout.gh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, draw.x, draw.y, draw.w, draw.h) // no background fill: transparency is how land is found
    let pixels: ImageData
    try {
      pixels = ctx.getImageData(0, 0, layout.gw, layout.gh)
    } catch {
      throw new ImportMapError('O navegador não deixou ler este SVG.') // a tainted canvas (e.g. foreignObject)
    }
    return landFromRgba(pixels.data, layout)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The drawing's size: the viewBox, else width/height in plain numbers or px (not %, em...). */
function svgSize(root: Element): { w: number; h: number } | null {
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (box.length === 4 && box[2] > 0 && box[3] > 0) return { w: box[2], h: box[3] }
  const len = (a: string) => {
    const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(root.getAttribute(a) ?? '')
    return m ? Number(m[1]) : NaN
  }
  const [w, h] = [len('width'), len('height')]
  return w > 0 && h > 0 ? { w, h } : null
}
