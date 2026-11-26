import { describe, expect, it } from 'vitest'
import { Biome, CLASSIC_BIOMES, FANTASY_BIOMES, FANTASY_HOSTS, isWaterBiome, LAND_BIOMES, resolveBiome, type FantasyBiome } from './biomes'
import { generate } from './generate'
import { parseWorld, serializeWorld } from './world'

const input = { seed: 'rios', width: 800, height: 500, continents: 3, waterPct: 50, cellCount: 4000 }
const w = generate(input)

describe('biomas', () => {
  it('oceano é exatamente a água abaixo do nível do mar ligada à borda; terra nunca é oceano', () => {
    for (let i = 0; i < w.biome.length; i++) {
      if (w.elevation[i] >= w.seaLevel) expect(w.biome[i]).not.toBe(Biome.Ocean)
    }
  })

  it('gera vários biomas de terra', () => {
    const land = new Set(Array.from(w.biome).filter((b) => !isWaterBiome(b)))
    expect(land.size).toBeGreaterThanOrEqual(3)
  })
})

describe('rios', () => {
  it('existem', () => {
    expect(w.rivers.length).toBeGreaterThan(0)
  })

  it('cada rio termina em água ou em outro rio, e nenhuma célula interna é água', () => {
    const riverCells = new Set(w.rivers.flatMap((r) => r.cells.slice(0, -1)))
    for (const r of w.rivers) {
      const end = r.cells[r.cells.length - 1]
      expect(isWaterBiome(w.biome[end]) || riverCells.has(end)).toBe(true)
      for (const c of r.cells.slice(0, -1)) expect(isWaterBiome(w.biome[c])).toBe(false)
    }
  })

  it('o fluxo nunca diminui rio abaixo', () => {
    for (const r of w.rivers) {
      for (let k = 1; k < r.flow.length; k++) expect(r.flow[k]).toBeGreaterThanOrEqual(r.flow[k - 1])
    }
  })

  it('nenhuma célula aparece em dois rios (exceto como ponto de encontro)', () => {
    const inner = w.rivers.flatMap((r) => r.cells.slice(0, -1))
    expect(new Set(inner).size).toBe(inner.length)
  })
})

describe('formato v2', () => {
  it('save -> load preserva biomas e rios', () => {
    expect(parseWorld(serializeWorld(w))).toEqual(w)
  })

  it('arquivo v1 (sem biomas/rios) é migrado igual ao gerado', () => {
    // A v1 file predates fantasy biomes: it was generated with the classic ones only.
    const old = generate({ ...input, biomes: CLASSIC_BIOMES })
    const o = JSON.parse(serializeWorld(old))
    delete o.biome
    delete o.rivers
    o.version = 1
    expect(parseWorld(JSON.stringify(o))).toEqual(old)
  })

  it('rejeita bioma desconhecido e rio com célula inexistente', () => {
    const bad1 = JSON.parse(serializeWorld(w))
    bad1.biome[0] = 99
    expect(() => parseWorld(JSON.stringify(bad1))).toThrow(/biome/)
    const bad2 = JSON.parse(serializeWorld(w))
    bad2.rivers[0].cells[0] = 1e9
    expect(() => parseWorld(JSON.stringify(bad2))).toThrow(/rivers/)
    const bad3 = JSON.parse(serializeWorld(w))
    bad3.rivers[0].flow[0] = -5
    expect(() => parseWorld(JSON.stringify(bad3))).toThrow(/negativo/)
  })
})

describe('biomas de fantasia e biomas da geração', () => {
  const classic = generate({ ...input, biomes: CLASSIC_BIOMES })
  const land = (m: typeof w) => [...m.biome].filter((b) => !isWaterBiome(b))
  const has = (list: readonly number[], b: number) => list.includes(b)

  it('só com os biomas clássicos não há fantasia; com todos, cada bioma de fantasia aparece só no seu hospedeiro', () => {
    expect(land(classic).every((b) => has(CLASSIC_BIOMES, b))).toBe(true)
    const all = generate({ ...input, biomes: LAND_BIOMES })
    for (let i = 0; i < all.biome.length; i++) {
      const f = all.biome[i]
      if (has(FANTASY_BIOMES, f)) expect(FANTASY_HOSTS[f as FantasyBiome]).toContain(classic.biome[i])
      else expect(f).toBe(classic.biome[i]) // patches never move the classic biomes around them
    }
    expect(land(all).some((b) => has(FANTASY_BIOMES, b))).toBe(true)
  })

  it('um bioma desmarcado não aparece e vira um marcado', () => {
    const noForest = CLASSIC_BIOMES.filter((b) => b !== Biome.Forest)
    const m = generate({ ...input, biomes: noForest })
    expect(m.biome.includes(Biome.Forest)).toBe(false)
    expect(land(m).every((b) => has(noForest, b))).toBe(true)
    expect(land(generate({ ...input, biomes: [Biome.MagicForest] })).every((b) => b === Biome.MagicForest)).toBe(true)
  })

  it('resolveBiome sempre devolve um bioma permitido', () => {
    for (let mask = 1; mask < 1 << LAND_BIOMES.length; mask++) {
      const allowed = LAND_BIOMES.filter((_, k) => mask & (1 << k))
      for (const b of CLASSIC_BIOMES) expect(allowed).toContain(resolveBiome(b, allowed))
    }
  })
})
