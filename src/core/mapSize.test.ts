import { describe, expect, it } from 'vitest'
import { DEFAULT_SIZE, radiusDefault, radiusMax, RADIUS_MIN, scaleRadius, SIZES, sizeById, sizeOfWorld } from './mapSize'
import { LIMITS } from './world'

describe('tamanhos de mapa', () => {
  it('células proporcionais à área (mesmo tamanho de célula), dentro do limite; Médio é o mapa de sempre', () => {
    expect(SIZES.map((s) => [s.width, s.height, s.cells])).toEqual([
      [1000, 625, 3000],
      [1600, 1000, 8000],
      [2400, 1500, 18000],
      [3200, 2000, 32000],
    ])
    for (const s of SIZES) expect(s.cells).toBeLessThanOrEqual(LIMITS.cellCount[1])
    expect(DEFAULT_SIZE.id).toBe('medium')
  })

  it('acha o tamanho de um mapa pelo lado maior; id desconhecido vira Médio', () => {
    expect(sizeOfWorld({ width: 1600, height: 1000 }).id).toBe('medium')
    expect(sizeOfWorld({ width: 1000, height: 1000 }).id).toBe('small')
    expect(sizeOfWorld({ width: 900, height: 2300 }).id).toBe('large') // a tall drawing from an SVG
    expect(sizeOfWorld({ width: 3000, height: 3000 }).id).toBe('huge')
    expect(sizeById('nope')).toBe(DEFAULT_SIZE)
  })

  it('o pincel mantém a mesma parte do mapa ao trocar de tamanho, dentro dos limites', () => {
    const [small, medium, , huge] = SIZES
    expect([radiusMax(medium), radiusDefault(medium)]).toEqual([200, 40])
    expect(scaleRadius(40, medium, small)).toBe(25)
    expect(scaleRadius(40, medium, huge)).toBe(80)
    expect(scaleRadius(200, medium, medium)).toBe(200)
    expect(scaleRadius(5, huge, small)).toBe(RADIUS_MIN)
  })
})
