import { describe, expect, it } from 'vitest'
import { Biome } from './biomes'
import { DEFAULTS } from './generate'
import { generateFromMask, IMPORT_SEA_LEVEL, ImportMapError, landFromRgba, maskLayout, type MaskLayout } from './importMask'
import { parseWorld, serializeWorld, WORLD_VERSION } from './world'

type Rgba = [number, number, number, number]
const CLEAR: Rgba = [0, 0, 0, 0]
const WHITE: Rgba = [255, 255, 255, 255]
const BLACK: Rgba = [0, 0, 0, 255]

/** The canvas the browser would hand over: `paint` gets the drawing's coordinates (0..1), the margin stays clear. */
function raster(layout: MaskLayout, paint: (u: number, v: number) => Rgba): Uint8ClampedArray {
  const { gw, gh, draw } = layout
  const out = new Uint8ClampedArray(gw * gh * 4)
  for (let y = draw.y; y < draw.y + draw.h; y++) {
    for (let x = draw.x; x < draw.x + draw.w; x++) out.set(paint((x - draw.x + 0.5) / draw.w, (y - draw.y + 0.5) / draw.h), 4 * (y * gw + x))
  }
  return out
}

const disc = (inside: Rgba, outside: Rgba, r = 0.35) => (u: number, v: number) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 < r * r ? inside : outside)

const layout = maskLayout(400, 300)
/** Mask pixels per map unit, and the sea band around the drawing in map units. */
const scale = layout.gw / layout.width
const margin = layout.draw.x / scale
/** Land at the drawing's point (u, v). */
const landAt = (land: Uint8Array, u: number, v: number) => {
  const { gw, draw } = layout
  return land[Math.floor(draw.y + v * draw.h) * gw + Math.floor(draw.x + u * draw.w)]
}

function nearestCell(points: Float32Array, x: number, y: number): number {
  let [best, bestD] = [0, Infinity]
  for (let c = 0; c < points.length / 2; c++) {
    const d = Math.hypot(points[2 * c] - x, points[2 * c + 1] - y)
    if (d < bestD) [best, bestD] = [c, d]
  }
  return best
}

const input = { ...DEFAULTS, seed: 'contorno', cellCount: 1500, kingdoms: 0 }

describe('maskLayout', () => {
  it('mapa na proporção do desenho, lado maior 1600, com faixa de mar', () => {
    expect(layout.width).toBe(1600)
    expect((layout.width - 2 * margin) / (layout.height - 2 * margin)).toBeCloseTo(400 / 300, 2)
    expect(layout.draw.x).toBeGreaterThan(0)
    expect(layout.draw.x + layout.draw.w).toBeLessThan(layout.gw)
    const tall = maskLayout(100, 1000)
    expect(tall.height).toBe(1600)
    expect(tall.width).toBeGreaterThanOrEqual(100)
  })

  it.each([
    [0, 100],
    [100, -1],
    [NaN, 100],
  ])('tamanho inválido (%s x %s) é recusado', (w, h) => {
    expect(() => maskLayout(w, h)).toThrow(ImportMapError)
  })
})

describe('landFromRgba', () => {
  it('fundo transparente: o que está desenhado é terra', () => {
    const { land } = landFromRgba(raster(layout, disc([200, 30, 30, 255], CLEAR)), layout)
    expect(landAt(land, 0.5, 0.5)).toBe(1)
    expect(landAt(land, 0.02, 0.02)).toBe(0)
    expect(land[0]).toBe(0) // margin
  })

  it('fundo branco: o escuro é terra', () => {
    const { land } = landFromRgba(raster(layout, disc(BLACK, WHITE)), layout)
    expect(landAt(land, 0.5, 0.5)).toBe(1)
    expect(landAt(land, 0.02, 0.02)).toBe(0)
  })

  it('terra verde em mar azul mais escuro: o mar é o lado que toca a borda', () => {
    const { land } = landFromRgba(raster(layout, disc([60, 160, 60, 255], [20, 50, 140, 255])), layout)
    expect(landAt(land, 0.5, 0.5)).toBe(1)
    expect(landAt(land, 0.02, 0.02)).toBe(0)
  })

  it('a faixa fora do desenho é mar mesmo com fundo opaco escuro', () => {
    const { land } = landFromRgba(raster(layout, () => BLACK), layout)
    expect(land[0]).toBe(0)
    expect(landAt(land, 0.5, 0.5)).toBe(1)
  })

  it.each([
    ['transparente', CLEAR],
    ['branco', WHITE],
  ])('desenho todo %s não tem terra', (_, color) => {
    expect(() => landFromRgba(raster(layout, () => color), layout)).toThrow(ImportMapError)
  })
})

describe('generateFromMask', () => {
  const mask = landFromRgba(raster(layout, disc(BLACK, WHITE)), layout)
  const w = generateFromMask(input, mask)
  const n = w.points.length / 2
  const pixelOf = (c: number) => Math.floor(w.points[2 * c + 1] * scale) * layout.gw + Math.floor(w.points[2 * c] * scale)

  it('a costa segue o desenho', () => {
    for (let c = 0; c < n; c++) expect(w.elevation[c] > w.seaLevel).toBe(mask.land[pixelOf(c)] === 1)
    expect(w.seaLevel).toBe(IMPORT_SEA_LEVEL)
  })

  it('mesmo desenho e seed geram o mesmo mapa', () => {
    expect(generateFromMask(input, mask)).toEqual(w)
  })

  it('o interior é mais alto que a costa', () => {
    let centre = 0
    let coast = 1
    for (let c = 0; c < n; c++) {
      const d = Math.hypot(w.points[2 * c] - w.width / 2, w.points[2 * c + 1] - w.height / 2)
      if (d < 60) centre = Math.max(centre, w.elevation[c])
      if (w.elevation[c] > w.seaLevel && d > 0.33 * (w.height - 2 * margin)) coast = Math.min(coast, w.elevation[c])
    }
    expect(centre).toBeGreaterThan(coast + 0.2)
  })

  it('salva e abre como um mapa normal', () => {
    expect(w.version).toBe(WORLD_VERSION)
    expect(parseWorld(serializeWorld(w))).toEqual(w)
    expect(w.params.waterPct).toBeGreaterThanOrEqual(5)
    expect(w.params.waterPct).toBeLessThanOrEqual(95)
  })

  it('gera reinos quando pedidos', () => {
    expect(generateFromMask({ ...input, kingdoms: 3 }, mask).states.length).toBe(3)
  })

  it('um buraco fechado no desenho vira lago', () => {
    const ring = landFromRgba(
      raster(layout, (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5)
        return r < 0.4 && r > 0.12 ? BLACK : WHITE
      }),
      layout,
    )
    const lake = generateFromMask(input, ring)
    expect(lake.biome[nearestCell(lake.points, lake.width / 2, lake.height / 2)]).toBe(Biome.Lake)
  })

  it('terra fina demais para as células é recusada', () => {
    const dot = landFromRgba(raster(layout, disc(BLACK, WHITE, 0.003)), layout)
    expect(() => generateFromMask(input, dot)).toThrow(ImportMapError)
  })
})
