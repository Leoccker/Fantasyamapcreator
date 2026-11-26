import { describe, expect, it } from 'vitest'
import { Biome, NO_BIOME } from './biomes'
import { DEFAULT_SETTINGS, patchSettings } from './settings'
import { generate } from './generate'
import { addIcon, addMarker } from './items'
import { parseWorld, serializeWorld, WORLD_VERSION, WorldParseError } from './world'

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

  it('mapa sem pintura salva biomeOverride vazio, e arquivo v2 abre sem pintura', () => {
    const o = JSON.parse(serializeWorld(generate(small)))
    expect(o.biomeOverride).toEqual([])
    delete o.biomeOverride
    o.version = 2
    const w = parseWorld(JSON.stringify(o))
    expect(w.version).toBe(WORLD_VERSION)
    expect(w.biomeOverride.every((b) => b === NO_BIOME)).toBe(true)
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
    ['biomeOverride com número ímpar de valores', () => JSON.stringify({ ...base(), biomeOverride: [1, 2, 3] })],
    ['biomeOverride em célula inexistente', () => JSON.stringify({ ...base(), biomeOverride: [1e9, Biome.Forest] })],
    ['biomeOverride pintando água', () => JSON.stringify({ ...base(), biomeOverride: [0, Biome.Ocean] })],
    ['biomeOverride com célula repetida', () => JSON.stringify({ ...base(), biomeOverride: [0, Biome.Forest, 0, Biome.Desert] })],
    ['markers não é lista', () => JSON.stringify({ ...base(), markers: 'x' })],
  ]
  it.each(bad)('rejeita %s', (_, make) => {
    expect(() => parseWorld(make())).toThrow(WorldParseError)
  })
})

describe('formato v4 (reinos, marcadores, rótulos)', () => {
  const k = generate({ ...small, kingdoms: 3 })

  it('salvar e abrir mantém reinos, marcadores e rótulos', () => {
    expect(k.states.length).toBe(3)
    expect(parseWorld(serializeWorld(k))).toEqual(k)
  })

  it('arquivo v3 abre sem reinos, e os parâmetros ainda regeram o mesmo mapa', () => {
    const o = JSON.parse(serializeWorld(generate(small)))
    for (const key of ['stateId', 'nextId']) delete o[key]
    delete o.params.kingdoms
    o.version = 3
    const w = parseWorld(JSON.stringify(o))
    expect(w.states).toEqual([])
    expect(w.stateId.every((s) => s === 0)).toBe(true)
    expect(w.params.kingdoms).toBe(0)
    expect(generate({ seed: w.seed, width: w.width, height: w.height, ...w.params })).toEqual(w)
  })

  const bad: [string, (o: any) => void][] = [
    ['reino inexistente em stateId', (o) => (o.stateId[o.stateId.findIndex((s: number) => s > 0)] = 99)],
    ['stateId com tamanho errado', (o) => o.stateId.pop()],
    ['marcador fora do mapa', (o) => (o.markers[0].x = 99999)],
    ['tipo de marcador desconhecido', (o) => (o.markers[0].kind = 'castelo')],
    ['id de marcador repetido', (o) => (o.markers[1].id = o.markers[0].id)],
    ['id acima de nextId', (o) => (o.nextId = 1)],
    ['cor inválida', (o) => (o.states[0].color = 'red')],
    ['capital que não existe', (o) => (o.states[0].capital = 99999)],
    ['nome longo demais', (o) => (o.markers[0].name = 'x'.repeat(500))],
    ['auto: false', (o) => (o.labels[0].auto = false)],
    ['tamanho de rótulo absurdo', (o) => (o.labels[0].size = 5000)],
    ['reinos acima do limite', (o) => (o.params.kingdoms = 50)],
  ]
  it.each(bad)('rejeita %s', (_, spoil) => {
    const o = JSON.parse(serializeWorld(k))
    spoil(o)
    expect(() => parseWorld(JSON.stringify(o))).toThrow(WorldParseError)
  })

  it('célula de água com reino no arquivo é limpa ao abrir', () => {
    const o = JSON.parse(serializeWorld(k))
    const water = o.biome.findIndex((b: number) => b === 0)
    o.stateId[water] = k.states[0].id
    expect(parseWorld(JSON.stringify(o)).stateId[water]).toBe(0)
  })
})

describe('formato v5 (configurações do mapa)', () => {
  const custom = patchSettings(generate(small), { gridType: 'square', gridKm: 12.5, kmPerUnit: 3, scaleCorner: 'tr', compassCorner: 'bl', title: 'Ilhas' })

  it('salvar e abrir mantém as configurações', () => {
    expect(parseWorld(serializeWorld(custom))).toEqual(custom)
  })

  it('arquivo v4 abre com as configurações padrão', () => {
    const o = JSON.parse(serializeWorld(custom))
    delete o.settings
    o.version = 4
    expect(parseWorld(JSON.stringify(o)).settings).toEqual(DEFAULT_SETTINGS)
  })

  it('editar sem mudar nada devolve o mesmo mundo; valores fora do limite são ajustados', () => {
    expect(patchSettings(custom, { gridKm: 12.5 })).toBe(custom)
    expect(patchSettings(custom, { kmPerUnit: 0 }).settings.kmPerUnit).toBe(0.01)
  })

  const badSettings: [string, (s: any) => void][] = [
    ['tipo de grade desconhecido', (s) => (s.gridType = 'triangular')],
    ['canto inválido', (s) => (s.compassCorner = 'meio')],
    ['escala zero', (s) => (s.kmPerUnit = 0)],
    ['grade absurda', (s) => (s.gridKm = 1e9)],
    ['título longo demais', (s) => (s.title = 'x'.repeat(500))],
  ]
  it.each(badSettings)('rejeita %s', (_, spoil) => {
    const o = JSON.parse(serializeWorld(custom))
    spoil(o.settings)
    expect(() => parseWorld(JSON.stringify(o))).toThrow(WorldParseError)
  })

  it('rejeita v5 sem settings', () => {
    const o = JSON.parse(serializeWorld(custom))
    delete o.settings
    expect(() => parseWorld(JSON.stringify(o))).toThrow(WorldParseError)
  })
})

describe('formato v6 (ícones enviados)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  const [withIcon, id] = addIcon(generate({ ...small, kingdoms: 2 }), 'Brasão', PNG)!
  const [w] = addMarker(withIcon, 'castle', 50, 50, id)

  it('salvar e abrir mantém os ícones e os marcadores que os usam', () => {
    expect(w.markers.at(-1)).toMatchObject({ kind: 'castle', icon: id, name: 'Brasão' })
    expect(parseWorld(serializeWorld(w))).toEqual(w)
  })

  it('arquivo v5 abre sem ícones', () => {
    const o = JSON.parse(serializeWorld(generate(small)))
    delete o.icons
    o.version = 5
    expect(parseWorld(JSON.stringify(o)).icons).toEqual([])
  })

  const bad: [string, (o: any) => void][] = [
    ['imagem SVG', (o) => (o.icons[0].src = 'data:image/svg+xml;base64,PHN2Zz4=')],
    ['link externo', (o) => (o.icons[0].src = 'https://exemplo.com/a.png')],
    ['script', (o) => (o.icons[0].src = 'javascript:alert(1)')],
    ['aspas no meio do dado', (o) => (o.icons[0].src = PNG + '"/><script>')],
    ['PNG sem a assinatura', (o) => (o.icons[0].src = 'data:image/png;base64,AAAA')],
    ['imagem grande demais', (o) => (o.icons[0].src = PNG + 'A'.repeat(50_000))],
    ['ícones demais', (o) => (o.icons = Array.from({ length: 33 }, (_, k) => ({ id: k + 1, name: 'x', src: PNG })))],
    ['id de ícone repetido', (o) => o.icons.push({ ...o.icons[0] })],
    ['marcador com ícone que não existe', (o) => (o.markers.at(-1).icon = 99)],
    ['tipo de marcador desconhecido', (o) => (o.markers[0].kind = 'disco voador')],
  ]
  it.each(bad)('rejeita %s', (_, spoil) => {
    const o = JSON.parse(serializeWorld(w))
    spoil(o)
    expect(() => parseWorld(JSON.stringify(o))).toThrow(WorldParseError)
  })
})
