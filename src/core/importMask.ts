// A drawing (an SVG rasterized by the browser) used as the land outline of a new map. Everything here is pure:
// the browser side (components/svgRaster.ts) only turns the file into RGBA pixels laid out by maskLayout().
// The coast follows the drawing exactly (fixed sea level); relief rises with the distance to the coast.
import { createNoise2D } from 'simplex-noise'
import { biomeSet } from './biomes'
import { fractalNoise, jitteredPoints, worldFromTerrain, type GenInput } from './generate'
import { clamp, smoothstep } from './math'
import { rngFor } from './rng'
import { ELEVATION_DECIMALS, LIMITS, round, type World } from './world'

export class ImportMapError extends Error {
  name = 'ImportMapError'
}

/** Long side of the new map, in map units, and the sea band around the drawing (share of the long side). */
const LONG_SIDE = 1600
const MARGIN = 0.06
/** Mask pixels per map unit: half resolution is still finer than the cells (about 14 units apart at 8000). */
const MASK_SCALE = 0.5
/** Fixed sea level: land is always above it and sea below, whatever the drawing's share of land. */
export const IMPORT_SEA_LEVEL = 0.3
/** Distance to the coast (map units) at which land reaches full height, and sea its full depth. */
const RIDGE = 192
const SHELF = 120

/** The new map's size, and where the drawing goes in the mask grid (whole pixels). The rest is sea. */
export interface MaskLayout {
  width: number
  height: number
  gw: number
  gh: number
  draw: { x: number; y: number; w: number; h: number }
}

/** 1 = land, one entry per mask pixel (gw * gh, row by row). */
export interface LandMask {
  layout: MaskLayout
  land: Uint8Array
}

/** Fits a drawing of svgW x svgH into a map with its proportions, long side LONG_SIDE, plus the sea margin. */
export function maskLayout(svgW: number, svgH: number): MaskLayout {
  if (!(svgW > 0 && svgH > 0 && Number.isFinite(svgW) && Number.isFinite(svgH))) throw new ImportMapError('O SVG tem um tamanho inválido.')
  const margin = Math.round(MARGIN * LONG_SIDE)
  const s = (LONG_SIDE - 2 * margin) / Math.max(svgW, svgH)
  const [iw, ih] = [Math.max(1, Math.round(svgW * s)), Math.max(1, Math.round(svgH * s))]
  const [width, height] = [iw + 2 * margin, ih + 2 * margin]
  const px = (v: number) => Math.max(1, Math.round(v * MASK_SCALE))
  return { width, height, gw: px(width), gh: px(height), draw: { x: px(margin), y: px(margin), w: px(iw), h: px(ih) } }
}

/**
 * Land from the rasterized drawing (RGBA, gw x gh). With a transparent background, whatever is drawn is land.
 * With a solid one, the colors are split in two (Otsu) and the side that holds most of the drawing's edge is sea,
 * so black-on-white and green-on-blue both work. Only the drawing's rectangle is read: the margin is sea.
 */
export function landFromRgba(rgba: ArrayLike<number>, layout: MaskLayout): LandMask {
  const { gw, gh, draw } = layout
  if (rgba.length !== gw * gh * 4) throw new ImportMapError('Imagem do SVG com tamanho inesperado.')
  const land = new Uint8Array(gw * gh)
  const x1 = Math.min(gw, draw.x + draw.w)
  const y1 = Math.min(gh, draw.y + draw.h)
  const total = (x1 - draw.x) * (y1 - draw.y)
  /** Visits the drawing's pixels: index into the mask (the RGBA offset is 4 * i), and position. */
  const each = (f: (i: number, x: number, y: number) => void) => {
    for (let y = draw.y; y < y1; y++) for (let x = draw.x; x < x1; x++) f(y * gw + x, x, y)
  }
  const opaque = (i: number) => rgba[4 * i + 3] >= 128

  // Transparent background: one pass marks what is drawn, and counts what isn't.
  let clear = 0
  each((i) => {
    land[i] = opaque(i) ? 1 : 0
    clear += 1 - land[i]
  })
  if (clear <= 0.005 * total) {
    // Solid background. Rec. 709 luma, composited over white for the few see-through pixels.
    const luma = new Uint8Array(gw * gh)
    const hist = new Uint32Array(256)
    each((i) => {
      const p = 4 * i
      const a = rgba[p + 3] / 255
      const l = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]
      luma[i] = Math.round(l * a + 255 * (1 - a))
      hist[luma[i]]++
    })
    const otsu = threshold(hist, total)
    const t = otsu ?? 127
    // Which side is land: the one that holds less of the drawing's edge (sea surrounds land); ties and a drawing
    // of a single color: dark is land.
    let darkEdge = 0
    let edge = 0
    each((i, x, y) => {
      if (x === draw.x || x === x1 - 1 || y === draw.y || y === y1 - 1) {
        edge++
        if (luma[i] <= t) darkEdge++
      }
    })
    const darkIsLand = otsu === null || darkEdge <= edge / 2
    each((i) => {
      land[i] = (luma[i] <= t) === darkIsLand ? 1 : 0
    })
  }

  if (!land.includes(1)) throw new ImportMapError('Não encontrei terra no desenho: ele está vazio, transparente ou de uma cor só clara.')
  return { layout, land }
}

/** Otsu's threshold (values <= t are one class), or null for an image of (nearly) one color. */
function threshold(hist: Uint32Array, total: number): number | null {
  let lo = 0
  let hi = 255
  while (lo < 255 && !hist[lo]) lo++
  while (hi > 0 && !hist[hi]) hi--
  if (hi - lo < 16) return null
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let best = 127
  let bestVar = -1
  let wB = 0
  let sumB = 0
  for (let v = 0; v < 255; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += v * hist[v]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > bestVar) {
      bestVar = between
      best = v
    }
  }
  return best
}

/**
 * Distance, in mask pixels, from each pixel to the nearest pixel where land === target (3-4 chamfer, two passes).
 * The caller guarantees at least one target pixel.
 */
function distanceTo(land: Uint8Array, gw: number, gh: number, target: 0 | 1): Float32Array {
  const d = new Float32Array(gw * gh)
  for (let i = 0; i < d.length; i++) d[i] = land[i] === target ? 0 : 1e9
  const relax = (i: number, x: number, y: number, cost: number) => {
    if (x >= 0 && x < gw && y >= 0 && y < gh && d[y * gw + x] + cost < d[i]) d[i] = d[y * gw + x] + cost
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      relax(i, x - 1, y, 3)
      relax(i, x - 1, y - 1, 4)
      relax(i, x, y - 1, 3)
      relax(i, x + 1, y - 1, 4)
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x
      relax(i, x + 1, y, 3)
      relax(i, x + 1, y + 1, 4)
      relax(i, x, y + 1, 3)
      relax(i, x - 1, y + 1, 4)
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

/**
 * A new map whose coast is the mask's outline. Seed, cell count and kingdoms come from `input`; continents is kept
 * for the next "Gerar", and waterPct records the drawing's real share of sea (within the allowed range).
 */
export function generateFromMask(input: Required<GenInput>, mask: LandMask): World {
  const { seed, cellCount, kingdoms, continents } = input
  const biomes = biomeSet(input.biomes)
  const { width, height, gw, gh } = mask.layout
  const toUnits = 1 / MASK_SCALE
  const toSea = distanceTo(mask.land, gw, gh, 0) // the margin is sea, so there is always some
  const toLand = distanceTo(mask.land, gw, gh, 1) // landFromRgba guarantees some land
  let deepest = 0
  for (let i = 0; i < toSea.length; i++) if (mask.land[i] && toSea[i] > deepest) deepest = toSea[i]
  // Full height at RIDGE inland, or sooner on a drawing whose land is all narrow, so small islands get hills too.
  const ridge = Math.min(RIDGE, Math.max(1, deepest * toUnits))

  const points = jitteredPoints(rngFor(seed, 'points'), width, height, cellCount)
  const fbm = fractalNoise(createNoise2D(rngFor(seed, 'noise')), width / height)
  const n = points.length / 2
  const elevation = new Float32Array(n)
  let sea = 0
  for (let c = 0; c < n; c++) {
    const [x, y] = [points[2 * c], points[2 * c + 1]]
    const i = clamp(Math.floor(y * MASK_SCALE), 0, gh - 1) * gw + clamp(Math.floor(x * MASK_SCALE), 0, gw - 1)
    const f = fbm(x / width, y / height)
    let e: number
    if (mask.land[i]) {
      const r = smoothstep(0, ridge, toSea[i] * toUnits)
      // Just above sea level at the coast, up to 1 inland: 60% from the distance, 40% noise (damped at the coast).
      e = IMPORT_SEA_LEVEL + 0.01 + (0.99 - IMPORT_SEA_LEVEL) * (0.6 * r + 0.4 * f * (0.3 + 0.7 * r))
    } else {
      sea++
      // Just below sea level at the coast, down to about 0.01 offshore (a shelf), with a little noise.
      e = IMPORT_SEA_LEVEL - 0.01 - (IMPORT_SEA_LEVEL - 0.02) * smoothstep(0, SHELF, toLand[i] * toUnits) * (0.85 + 0.15 * f)
    }
    elevation[c] = round(e, ELEVATION_DECIMALS)
  }
  if (sea === n) {
    throw new ImportMapError('A terra do desenho é fina demais para as células do mapa. Aumente o número de células ou engrosse o desenho.')
  }

  const waterPct = clamp(Math.round((100 * sea) / n), ...LIMITS.waterPct)
  const terrain = { seed, width, height, seaLevel: IMPORT_SEA_LEVEL, points, elevation }
  return worldFromTerrain(terrain, { continents, waterPct, cellCount, kingdoms, biomes })
}
