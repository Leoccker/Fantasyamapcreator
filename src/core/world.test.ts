import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { parseWorld, serializeWorld, WorldParseError } from './world'

const small = { seed: 'teste', width: 400, height: 300, continents: 2, waterPct: 60, cellCount: 1500 }

describe('serialização', () => {
  it('save -> load devolve o mesmo mundo', () => {
    const w = generate(small)
    expect(parseWorld(serializeWorld(w))).toEqual(w)
  })

  it('params importados regeram exatamente o mesmo mapa', () => {
    const w = parseWorld(serializeWorld(generate(small)))
    expect(generate({ seed: w.seed, width: w.width, height: w.height, ...w.params })).toEqual(w)
  })

  it('aceita arquivo sem as listas reservadas', () => {
    const o = JSON.parse(serializeWorld(generate(small)))
    delete o.markers
    expect(parseWorld(JSON.stringify(o)).markers).toEqual([])
  })

  const base = () => JSON.parse(serializeWorld(generate(small)))
  const bad: [string, () => string][] = [
    ['texto que não é JSON', () => 'not json'],
    ['objeto vazio', () => '{}'],
    ['lista em vez de objeto', () => '[]'],
    ['versão do futuro', () => JSON.stringify({ ...base(), version: 99 })],
    ['versão zero', () => JSON.stringify({ ...base(), version: 0 })],
    ['points com tamanho errado', () => {
      const o = base()
      o.points.pop()
      return JSON.stringify(o)
    }],
    ['null em elevation', () => {
      const o = base()
      o.elevation[3] = null
      return JSON.stringify(o)
    }],
    ['ponto fora do mapa', () => {
      const o = base()
      o.points[0] = 99999
      return JSON.stringify(o)
    }],
    ['waterPct absurdo', () => {
      const o = base()
      o.params.waterPct = 500
      return JSON.stringify(o)
    }],
    ['continentes acima do limite da UI', () => {
      const o = base()
      o.params.continents = 10
      return JSON.stringify(o)
    }],
    ['seaLevel fora de 0..1', () => JSON.stringify({ ...base(), seaLevel: 7 })],
    ['markers não é lista', () => JSON.stringify({ ...base(), markers: 'x' })],
  ]
  it.each(bad)('rejeita %s', (_, make) => {
    expect(() => parseWorld(make())).toThrow(WorldParseError)
  })
})
