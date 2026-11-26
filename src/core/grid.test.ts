import { describe, expect, it } from 'vitest'
import { gridCellUnits, gridSegments, hexCenter, MIN_CELL_UNITS } from './grid'
import { formatKm, niceKm, scaleBarSpec } from './scale'

const segs = (f: Float32Array) => Array.from({ length: f.length / 4 }, (_, k) => [f[4 * k], f[4 * k + 1], f[4 * k + 2], f[4 * k + 3]])
const len = ([a, b, c, d]: number[]) => Math.hypot(c - a, d - b)

describe('grade', () => {
  it('hexágonos vizinhos ficam a exatamente um tamanho de distância', () => {
    const size = 30
    const [x0, y0] = hexCenter(4, 4, size)
    // col 4 is even; the odd columns beside it sit half a cell lower, so their neighbors are rows 3 and 4
    for (const [c, r] of [[4, 3], [4, 5], [5, 3], [5, 4], [3, 3], [3, 4]]) {
      const [x, y] = hexCenter(c, r, size)
      expect(Math.hypot(x - x0, y - y0)).toBeCloseTo(size, 9)
    }
  })

  it('toda aresta de hexágono mede R, e nenhuma aresta se repete', () => {
    const size = 30
    const s = segs(gridSegments('hex', size, 300, 200))
    for (const e of s) expect(len(e)).toBeCloseTo(size / Math.sqrt(3), 3)
    const key = ([a, b, c, d]: number[]) => [[a, b], [c, d]].map((p) => p.map((v) => v.toFixed(2)).join(',')).sort().join('|')
    expect(new Set(s.map(key)).size).toBe(s.length)
  })

  it('grade quadrada tem as linhas esperadas', () => {
    const s = segs(gridSegments('square', 50, 200, 100))
    expect(s).toHaveLength(5 + 3) // x = 0,50,...,200 and y = 0,50,100
  })

  it('tamanho em km vira unidades do mapa, com mínimo legível', () => {
    expect(gridCellUnits({ gridKm: 50, kmPerUnit: 2 }, 1600, 1000)).toEqual({ size: 25, clamped: false })
    const tiny = gridCellUnits({ gridKm: 1, kmPerUnit: 1 }, 1600, 1000)
    expect(tiny.clamped).toBe(true)
    expect(tiny.size).toBeGreaterThanOrEqual(MIN_CELL_UNITS)
  })
})

describe('escala', () => {
  it('arredonda para 1, 2 ou 5 × 10^n', () => {
    expect([0.7, 1, 1.9, 2, 4.9, 5, 99, 1000, 0.3].map(niceKm)).toEqual([0.5, 1, 1, 2, 2, 5, 50, 1000, 0.2])
    expect(niceKm(0)).toBe(0)
  })

  it('a barra mede km / (km por unidade) e tem rótulo em pt-BR', () => {
    const b = scaleBarSpec(2.5, 240)
    expect(b.km).toBe(500)
    expect(b.units).toBe(200)
    expect(b.label).toBe('500 km')
    expect(formatKm(1500)).toBe('1.500 km')
  })
})
