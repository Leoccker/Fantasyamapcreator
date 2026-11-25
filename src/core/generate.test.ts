import { describe, expect, it } from 'vitest'
import { generate, type GenInput } from './generate'
import { buildMesh, coastEdges } from './mesh'

const small: GenInput = { seed: 'teste', width: 400, height: 300, continents: 2, waterPct: 60, cellCount: 2000 }

const waterShare = (w: ReturnType<typeof generate>) =>
  w.elevation.filter((h) => h < w.seaLevel).length / w.elevation.length

describe('generate', () => {
  it('mesma seed gera o mesmo mundo', () => {
    expect(generate(small)).toEqual(generate(small))
  })

  it('seed diferente gera alturas diferentes', () => {
    expect(generate({ ...small, seed: 'outra' }).elevation).not.toEqual(generate(small).elevation)
  })

  it('mudar só continentes não muda os pontos (streams independentes)', () => {
    expect(generate({ ...small, continents: 5 }).points).toEqual(generate(small).points)
  })

  it.each([30, 60, 80])('água fica perto de %i%%', (pct) => {
    expect(Math.abs(waterShare(generate({ ...small, waterPct: pct })) - pct / 100)).toBeLessThan(0.015)
  })

  it('alturas válidas e borda do mapa é mar', () => {
    const w = generate({ ...small, waterPct: 30 })
    expect(w.elevation.length).toBe(w.points.length / 2)
    expect(w.points.length / 2).toBeGreaterThanOrEqual(w.params.cellCount)
    expect(w.elevation.every((h) => h >= 0 && h <= 1)).toBe(true)
    let border = 0
    let wet = 0
    for (let i = 0; i < w.elevation.length; i++) {
      const x = w.points[2 * i] / w.width
      const y = w.points[2 * i + 1] / w.height
      if (Math.min(x, 1 - x, y, 1 - y) < 0.03) {
        border++
        if (w.elevation[i] < w.seaLevel) wet++
      }
    }
    expect(wet / border).toBeGreaterThan(0.95)
  })
})

describe('mesh', () => {
  const w = generate(small)
  const m = buildMesh(w.points, w.width, w.height)

  it('toda célula tem vizinhos e a relação é simétrica', () => {
    for (let i = 0; i < m.n; i++) {
      expect(m.nOff[i + 1]).toBeGreaterThan(m.nOff[i])
      for (let k = m.nOff[i]; k < m.nOff[i + 1]; k++) {
        const j = m.nIdx[k]
        expect(Array.from(m.nIdx.subarray(m.nOff[j], m.nOff[j + 1]))).toContain(i)
      }
    }
  })

  it('costa existe e vem em segmentos de 4 números', () => {
    const e = coastEdges(w, m)
    expect(e.length).toBeGreaterThan(0)
    expect(e.length % 4).toBe(0)
  })
})
