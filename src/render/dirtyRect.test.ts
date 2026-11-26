import { describe, expect, it } from 'vitest'
import { patchRects } from './dirtyRect'

// One square cell from (100,100) to (110,110), on a 1000x500 map.
const polys = [Float32Array.of(100, 100, 110, 100, 110, 110, 100, 110), null]

describe('patchRects (área redesenhada durante o traço)', () => {
  it('retângulos inteiros em pixels; o copiado fica dentro do desenhado', () => {
    for (const scale of [1, 1.5, 2]) {
      const r = patchRects(polys, [0], scale, 1000 * scale, 500 * scale)!
      for (const v of [...Object.values(r.outer), ...Object.values(r.inner)]) expect(Number.isInteger(v)).toBe(true)
      expect(r.inner.x).toBeGreaterThan(r.outer.x)
      expect(r.inner.x + r.inner.w).toBeLessThan(r.outer.x + r.outer.w)
      // The copied part covers the cell and its reach.
      expect(r.inner.x).toBeLessThanOrEqual(100 * scale)
      expect(r.inner.y + r.inner.h).toBeGreaterThanOrEqual(110 * scale)
    }
  })

  it('para na borda do mapa', () => {
    const r = patchRects([Float32Array.of(0, 0, 5, 0, 5, 5)], [0], 1, 1000, 500)!
    expect(r.outer).toMatchObject({ x: 0, y: 0 })
    expect(r.inner).toMatchObject({ x: 0, y: 0 })
  })

  it('sem células (ou só células sem polígono) não redesenha nada; área grande pede desenho completo', () => {
    expect(patchRects(polys, [], 1, 1000, 500)).toBeNull()
    expect(patchRects(polys, [1], 1, 1000, 500)).toBeNull()
    expect(patchRects([Float32Array.of(0, 0, 900, 0, 900, 400)], [0], 1, 1000, 500)).toBeNull()
  })
})
