// Headless pure-SVG + PNG map renderer for Node (no DOM / browser required).
// Reuses the app's exact line work (coast, rivers, relief, borders) and annotations (grid, markers, labels,
// scale bar, compass, frame) via SvgContext, plus vector polygon fills for sea, land, biomes and kingdom tints.
import { Resvg } from '@resvg/resvg-js'
import type { LandBiome } from '../core/biomes'
import { coastEdges, getMesh, isLand } from '../core/mesh'
import type { World } from '../core/world'
import { chainEdges, smooth } from '../render/coast'
import { drawAnnotations } from '../render/decor'
import { DEFAULT_LAYERS, drawLineWork, type Layers } from '../render/draw'
import { BIOME_COLORS, PAPER } from '../render/palette'
import { fmt, PathData } from '../render/path'
import { asCanvas, esc, SvgContext } from '../render/svgContext'
import { framePad } from '../render/view'

export interface RenderOptions {
  layers?: Partial<Layers>
  /** Target output width in pixels for PNG rasterization (default 1024, clamped 256..4096). */
  maxWidth?: number
}

function buildLandPathData(w: World): string {
  const mesh = getMesh(w)
  const coast = chainEdges(coastEdges(w, mesh)).map((l) => smooth(l))
  const d = new PathData()
  for (const { pts, closed } of coast) {
    if (pts.length < 2) continue
    d.moveTo(pts[0], pts[1])
    for (let k = 2; k < pts.length; k += 2) d.lineTo(pts[k], pts[k + 1])
    if (closed) d.closePath()
  }
  return d.d
}

function groupCellPolygons(w: World, colorOf: (cell: number) => string | undefined): Map<string, string> {
  const mesh = getMesh(w)
  const buckets = new Map<string, string[]>()
  for (let i = 0; i < mesh.n; i++) {
    if (!isLand(w, i)) continue
    const color = colorOf(i)
    const poly = mesh.polys[i]
    if (!color || !poly || poly.length < 6) continue
    let list = buckets.get(color)
    if (!list) buckets.set(color, (list = []))
    let seg = `M${fmt(poly[0])} ${fmt(poly[1])}`
    for (let k = 2; k < poly.length; k += 2) seg += `L${fmt(poly[k])} ${fmt(poly[k + 1])}`
    seg += 'Z'
    list.push(seg)
  }
  const out = new Map<string, string>()
  for (const [color, segs] of buckets) out.set(color, segs.join(''))
  return out
}

/** Renders the full map sheet as a standalone vector SVG string in pure Node. */
export function renderWorldSvg(w: World, opts: RenderOptions = {}): string {
  const layers: Layers = { ...DEFAULT_LAYERS, ...opts.layers }
  const pad = framePad(w, layers.frame)
  const W = w.width + 2 * pad
  const H = w.height + 2 * pad
  const scale = opts.maxWidth ? Math.max(0.25, Math.min(4, opts.maxWidth / W)) : 1

  const landD = buildLandPathData(w)
  const waterD = `M0 0h${fmt(w.width)}v${fmt(w.height)}h${fmt(-w.width)}Z${landD}`

  const baseParts: string[] = []
  baseParts.push(`<rect x="${fmt(-pad)}" y="${fmt(-pad)}" width="${fmt(W)}" height="${fmt(H)}" fill="${PAPER}"/>`)
  baseParts.push(`<g clip-path="url(#mcpMapClip)">`)
  // Water tint outside land (and inside lakes via evenodd).
  baseParts.push(`<path d="${waterD}" fill-rule="evenodd" fill="rgb(96,122,128)" fill-opacity="0.22"/>`)

  // Subtle sea contour ripples around coasts when hatching is enabled.
  if (layers.hatching && landD) {
    baseParts.push(`<g mask="url(#mcpSeaMask)" fill="none" stroke="rgb(59,42,26)" stroke-linejoin="round" stroke-linecap="round">`)
    baseParts.push(`<path d="${landD}" stroke-width="18" stroke-opacity="0.06"/>`)
    baseParts.push(`<path d="${landD}" stroke-width="10" stroke-opacity="0.10"/>`)
    baseParts.push(`<path d="${landD}" stroke-width="4" stroke-opacity="0.16"/>`)
    baseParts.push(`</g>`)
  }

  // Soft biome fills clipped to the smoothed land silhouette.
  if (layers.biomes && landD) {
    const biomeGroups = groupCellPolygons(w, (i) => BIOME_COLORS[w.biome[i] as LandBiome])
    baseParts.push(`<g clip-path="url(#mcpLandClip)" opacity="0.58">`)
    for (const [color, d] of biomeGroups) {
      baseParts.push(`<path d="${d}" fill="${esc(color)}" stroke="${esc(color)}" stroke-width="0.9" stroke-linejoin="round"/>`)
    }
    baseParts.push(`</g>`)
  }

  // Optional kingdom territory tinting.
  if (layers.tint && w.states.length && landD) {
    const colors = new Map(w.states.map((st) => [st.id, st.color]))
    const stateGroups = groupCellPolygons(w, (i) => colors.get(w.stateId[i]))
    baseParts.push(`<g clip-path="url(#mcpLandClip)" opacity="0.28">`)
    for (const [color, d] of stateGroups) {
      baseParts.push(`<path d="${d}" fill="${esc(color)}" stroke="${esc(color)}" stroke-width="0.9" stroke-linejoin="round"/>`)
    }
    baseParts.push(`</g>`)
  }
  baseParts.push(`</g>`)

  // Record exact line work (rivers, relief, borders, coast) and annotations (grid, markers, labels, scale, compass, frame).
  const svg = new SvgContext(scale)
  drawLineWork(asCanvas(svg), w, layers)
  drawAnnotations(asCanvas(svg), w, { layers, textReady: true, pad })

  const defs = [
    `<clipPath id="mcpMapClip"><rect x="0" y="0" width="${fmt(w.width)}" height="${fmt(w.height)}"/></clipPath>`,
    landD ? `<clipPath id="mcpLandClip"><path d="${landD}" clip-rule="evenodd"/></clipPath>` : '',
    layers.hatching && landD
      ? `<mask id="mcpSeaMask"><rect x="0" y="0" width="${fmt(w.width)}" height="${fmt(w.height)}" fill="white"/><path d="${landD}" fill-rule="evenodd" fill="black"/></mask>`
      : '',
    svg.defsXml(),
  ]
    .filter(Boolean)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(W)}" height="${fmt(H)}" viewBox="${fmt(-pad)} ${fmt(-pad)} ${fmt(W)} ${fmt(H)}">
<defs>
${defs}
</defs>
${baseParts.join('\n')}
${svg.body()}
</svg>
`
}

/** Rasterizes the map to a PNG Buffer using @resvg/resvg-js. */
export function renderWorldPng(w: World, opts: RenderOptions = {}): { png: Buffer; width: number; height: number } {
  const layers: Layers = { ...DEFAULT_LAYERS, ...opts.layers }
  const pad = framePad(w, layers.frame)
  const W = w.width + 2 * pad
  const maxWidth = Math.round(Math.max(256, Math.min(4096, opts.maxWidth ?? 1024)))
  const targetWidth = Math.min(maxWidth, Math.round(W * 2))

  const svg = renderWorldSvg(w, { ...opts, layers, maxWidth: targetWidth })
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: targetWidth },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'serif',
    },
  })
  const rendered = resvg.render()
  return {
    png: Buffer.from(rendered.asPng()),
    width: rendered.width,
    height: rendered.height,
  }
}
