// SVG export, hybrid: the painterly base (paper, sea hatching, watercolor tints) is one embedded PNG, since
// its blur, compositing and noise have no light SVG equivalent; everything drawn on top of it (coast, rivers,
// relief, borders, grid, markers, labels, scale bar, compass, frame) is real vector, recorded from the same
// drawing code as the screen. Loaded on demand (it carries the font files).
import fontItalic from '@fontsource/im-fell-english/files/im-fell-english-latin-400-italic.woff2?inline'
import fontNormal from '@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff2?inline'
import type { World } from '../core/world'
import { drawAnnotations } from './decor'
import { drawLineWork, type Layers } from './draw'
import { fontsReady } from './fonts'
import { iconsReady } from './iconImages'
import { MAX_CANVAS, renderTo } from './renderer'
import { asCanvas, SvgContext } from './svgContext'
import { framePad } from './view'

/** Raster base resolution, device pixels per map unit (same as the PNG export). */
const BASE_SCALE = 2
const BASE_QUALITY = 0.9

const fontFace = (style: string, src: string) =>
  `@font-face{font-family:'IM Fell English';font-style:${style};font-weight:400;src:url(${src}) format('woff2')}`

/** The full sheet as an SVG file (text stays text, with the map font embedded). */
export async function renderSvg(w: World, layers: Layers): Promise<Blob> {
  await Promise.all([fontsReady(), iconsReady(w)])
  const pad = framePad(w, layers.frame)
  const scale = Math.min(BASE_SCALE, MAX_CANVAS / Math.max(w.width, w.height))
  // JPEG: the base is opaque, and its paper noise would make a PNG about ten times bigger.
  const base = renderTo(w, scale, layers, undefined, 0, true).toDataURL('image/jpeg', BASE_QUALITY)

  const svg = new SvgContext(scale) // hairlines (the grid) as thin as in the PNG
  drawLineWork(asCanvas(svg), w, layers)
  drawAnnotations(asCanvas(svg), w, { layers, textReady: true, pad })

  const [W, H] = [w.width + 2 * pad, w.height + 2 * pad]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${-pad} ${-pad} ${W} ${H}">
<defs>
<style>${fontFace('normal', fontNormal)}${fontFace('italic', fontItalic)}</style>
${svg.defsXml()}
</defs>
<image xlink:href="${base}" x="0" y="0" width="${w.width}" height="${w.height}" preserveAspectRatio="none"/>
${svg.body()}
</svg>
`
  return new Blob([xml], { type: 'image/svg+xml' })
}
