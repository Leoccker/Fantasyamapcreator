import { describe, expect, it } from 'vitest'
import { Biome, isWaterBiome, NO_BIOME } from './biomes'
import { cellsInRadius, commitSession, startSession, strokeTo, type Brush } from './brush'
import { generate } from './generate'
import { createHistory } from './history'
import { getMesh } from './mesh'
import { ELEVATION_DECIMALS, parseWorld, round, serializeWorld, type World } from './world'

const w = generate({ seed: 'pincel', width: 800, height: 500, continents: 2, waterPct: 50, cellCount: 3000 })
const mesh = getMesh(w)
const brush: Brush = { radius: 40, strength: 0.8, biome: Biome.Desert, state: 0, marker: 'city' }

/** A land cell far from the coast, to brush on. */
const inland = (() => {
  let best = 0
  for (let i = 0; i < mesh.n; i++) if (w.elevation[i] > w.elevation[best]) best = i
  return best
})()
const at = (i: number): [number, number] => [w.points[2 * i], w.points[2 * i + 1]]

function stroke(base: World, tool: Parameters<typeof startSession>[1], path: [number, number][], b = brush) {
  const s = startSession(base, tool)
  for (const [x, y] of path) strokeTo(s, x, y, b)
  return s
}

describe('cellsInRadius', () => {
  it('acha exatamente as células dentro do raio (igual a varrer todas)', () => {
    const [x, y] = [400, 250]
    const got = cellsInRadius(mesh, w.points, x, y, 50).map(([i]) => i).sort((a, b) => a - b)
    const brute: number[] = []
    for (let i = 0; i < mesh.n; i++) if (Math.hypot(w.points[2 * i] - x, w.points[2 * i + 1] - y) < 50) brute.push(i)
    expect(got).toEqual(brute)
  })
})

describe('pincel de relevo', () => {
  it('elevar só sobe células dentro do raio, rebaixar só desce', () => {
    const [x, y] = at(inland)
    const up = stroke(w, 'raise', [[x, y]])
    const down = stroke(w, 'lower', [[x, y]])
    for (let i = 0; i < mesh.n; i++) {
      const inside = Math.hypot(w.points[2 * i] - x, w.points[2 * i + 1] - y) < brush.radius
      if (!inside) {
        expect(up.elevation[i]).toBe(w.elevation[i])
        expect(down.elevation[i]).toBe(w.elevation[i])
      } else {
        expect(up.elevation[i]).toBeGreaterThanOrEqual(w.elevation[i])
        expect(down.elevation[i]).toBeLessThanOrEqual(w.elevation[i])
      }
    }
  })

  it('valores ficam entre 0 e 1 mesmo com muitas passadas', () => {
    const [x, y] = at(inland)
    const s = stroke(w, 'raise', Array.from({ length: 200 }, (_, k) => [x + (k % 2), y] as [number, number]), { ...brush, strength: 1 })
    expect(s.elevation.every((v) => v >= 0 && v <= 1)).toBe(true)
  })

  it('suavizar reduz a variação local', () => {
    const [x, y] = at(inland)
    const s = stroke(w, 'smooth', [[x, y], [x + 30, y]])
    const variance = (e: Float32Array) => {
      const cells = [...s.touched]
      const mean = cells.reduce((a, i) => a + e[i], 0) / cells.length
      return cells.reduce((a, i) => a + (e[i] - mean) ** 2, 0)
    }
    expect(variance(s.elevation)).toBeLessThan(variance(w.elevation))
  })

  it('o resultado não depende de como o movimento do mouse foi dividido', () => {
    const [x, y] = at(inland)
    const oneMove = stroke(w, 'raise', [[x, y], [x + 100, y + 40]])
    const manyMoves = stroke(w, 'raise', [[x, y], ...Array.from({ length: 10 }, (_, k) => [x + 10 * (k + 1), y + 4 * (k + 1)] as [number, number])])
    expect(manyMoves.elevation).toEqual(oneMove.elevation)
  })

  it('confirmar: arredonda, recalcula rios, mantém pontos e malha, não mexe no mundo original', () => {
    const before = Float32Array.from(w.elevation)
    const edited = commitSession(stroke(w, 'raise', [at(inland)]))!
    expect(w.elevation).toEqual(before)
    expect(edited.points).toBe(w.points)
    expect(getMesh(edited)).toBe(mesh)
    expect(edited.seaLevel).toBe(w.seaLevel)
    expect(edited.elevation).toEqual(edited.elevation.map((v) => round(v, ELEVATION_DECIMALS)))
    expect(parseWorld(serializeWorld(edited))).toEqual(edited)
  })

  it('traço vazio não gera mudança', () => {
    expect(commitSession(startSession(w, 'raise'))).toBeNull()
  })
})

describe('pincel de bioma', () => {
  const painted = commitSession(stroke(w, 'biome', [at(inland)]))!

  it('pinta só terra e marca o override', () => {
    let count = 0
    for (let i = 0; i < mesh.n; i++) {
      if (painted.biomeOverride[i] === NO_BIOME) continue
      count++
      expect(isWaterBiome(w.biome[i])).toBe(false)
      expect(painted.biome[i]).toBe(Biome.Desert)
    }
    expect(count).toBeGreaterThan(0)
    expect(painted.rivers).toBe(w.rivers)
  })

  it('a pintura sobrevive a uma edição de relevo depois', () => {
    const [x, y] = at(inland)
    const raised = commitSession(stroke(painted, 'raise', [[x + 5, y]], { ...brush, strength: 0.1 }))!
    for (let i = 0; i < mesh.n; i++) {
      if (raised.biomeOverride[i] !== NO_BIOME && !isWaterBiome(raised.biome[i])) expect(raised.biome[i]).toBe(Biome.Desert)
    }
  })

  it('se a célula pintada vira mar, a água vence, mas a pintura fica guardada', () => {
    const [x, y] = at(inland)
    let sunk = painted
    for (let k = 0; k < 40; k++) sunk = commitSession(stroke(sunk, 'lower', [[x, y]], { ...brush, strength: 1 }))!
    const cell = mesh.delaunay.find(x, y)
    expect(isWaterBiome(sunk.biome[cell])).toBe(true)
    expect(sunk.biomeOverride[cell]).toBe(Biome.Desert)
  })

  it('pintura salva e carrega igual (formato v3)', () => {
    expect(parseWorld(serializeWorld(painted))).toEqual(painted)
  })
})

describe('histórico', () => {
  it('desfazer e refazer voltam exatamente os mesmos mundos, sem copiar os pontos', () => {
    const h = createHistory<World>()
    const a = w
    const b = commitSession(stroke(a, 'raise', [at(inland)]))!
    h.push(a)
    const c = commitSession(stroke(b, 'biome', [at(inland)]))!
    h.push(b)
    expect(h.undo(c)).toBe(b)
    expect(h.undo(b)).toBe(a)
    expect(h.undo(a)).toBeNull()
    expect(h.redo(a)).toBe(b)
    expect(h.redo(b)).toBe(c)
    for (const x of [a, b, c]) expect(x.points).toBe(w.points)
  })

  it('guarda no máximo 50 passos, e editar depois de desfazer apaga o refazer', () => {
    const h = createHistory<number>()
    for (let k = 0; k < 60; k++) h.push(k)
    let undos = 0
    for (let cur = 60; ; undos++) {
      const p = h.undo(cur)
      if (p === null) break
      cur = p
    }
    expect(undos).toBe(50)
    h.push(1)
    expect(h.canRedo()).toBe(false)
    h.clear()
    expect(h.canUndo()).toBe(false)
  })
})
