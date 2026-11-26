import { describe, expect, it } from 'vitest'
import { generate } from '../core/generate'
import { coastEdges, getMesh } from '../core/mesh'
import { chainEdges, smooth } from './coast'

describe('costa', () => {
  it('um quadrado vira um contorno fechado de 4 pontos', () => {
    const sq = Float32Array.from([0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1])
    const lines = chainEdges(sq)
    expect(lines).toHaveLength(1)
    expect(lines[0].closed).toBe(true)
    expect(lines[0].pts).toHaveLength(8)
  })

  it('costa de um mapa gerado vira só contornos fechados, usando todas as arestas', () => {
    const w = generate({ seed: 'costa', width: 800, height: 500, continents: 3, waterPct: 55, cellCount: 3000 })
    const edges = coastEdges(w, getMesh(w))
    const lines = chainEdges(edges)
    expect(lines.every((l) => l.closed)).toBe(true)
    expect(lines.reduce((s, l) => s + l.pts.length / 2, 0)).toBe(edges.length / 4)
  })

  it('Chaikin dobra os pontos de um contorno fechado a cada passo', () => {
    const loop = { pts: [0, 0, 10, 0, 10, 10, 0, 10], closed: true }
    expect(smooth(loop, 1).pts).toHaveLength(16)
    expect(smooth(loop, 2).pts).toHaveLength(32)
  })
})
