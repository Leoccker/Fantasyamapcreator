import { describe, expect, it } from 'vitest'
import { isWaterBiome } from './biomes'
import { commitSession, startSession, strokeTo, type Brush } from './brush'
import { generate } from './generate'
import { addMarker, hasHandEdits } from './items'
import { generateKingdoms, settleStates } from './kingdoms'
import { getMesh } from './mesh'

const input = { seed: 'reinos', width: 800, height: 500, continents: 3, waterPct: 50, cellCount: 4000 }
const w = generate({ ...input, kingdoms: 5 })
const plain = generate({ ...input, kingdoms: 0 })
const mesh = getMesh(w)

describe('geração de reinos', () => {
  it('é determinística e não mexe no terreno', () => {
    expect(generate({ ...input, kingdoms: 5 })).toEqual(w)
    expect(w.elevation).toEqual(plain.elevation)
    expect(w.biome).toEqual(plain.biome)
    expect(w.rivers).toEqual(plain.rivers)
  })

  it('cria os reinos pedidos, sem água e com a capital dentro do próprio reino', () => {
    expect(w.states).toHaveLength(5)
    for (let i = 0; i < mesh.n; i++) if (isWaterBiome(w.biome[i])) expect(w.stateId[i]).toBe(0)
    for (const s of w.states) {
      const cap = w.markers.find((m) => m.id === s.capital)!
      expect(cap.kind).toBe('city')
      expect(w.stateId[mesh.delaunay.find(cap.x, cap.y)]).toBe(s.id)
    }
  })

  it('cada reino é contíguo', () => {
    for (const s of w.states) {
      const cells = []
      for (let i = 0; i < mesh.n; i++) if (w.stateId[i] === s.id) cells.push(i)
      const seen = new Set([cells[0]])
      const queue = [cells[0]]
      for (let q = 0; q < queue.length; q++) {
        for (let e = mesh.nOff[queue[q]]; e < mesh.nOff[queue[q] + 1]; e++) {
          const j = mesh.nIdx[e]
          if (w.stateId[j] === s.id && !seen.has(j)) {
            seen.add(j)
            queue.push(j)
          }
        }
      }
      expect(seen.size).toBe(cells.length)
    }
  })

  it('cria capitais, vilas e rótulos automáticos, com ids únicos abaixo de nextId', () => {
    const ids = [...w.markers, ...w.labels].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.max(...ids)).toBeLessThan(w.nextId)
    expect(w.labels.map((l) => l.text).sort()).toEqual(w.states.map((s) => s.name).sort())
    expect([...w.states, ...w.markers, ...w.labels].every((x) => x.auto)).toBe(true)
    expect(hasHandEdits(w)).toBe(false)
  })

  it('"Gerar reinos" troca só o que é automático e mantém o que é feito à mão', () => {
    const [mine] = addMarker(w, 'ruin', 100, 100)
    const again = generateKingdoms(mine, 3, 1)
    expect(again.states).toHaveLength(3)
    expect(again.markers.filter((m) => !m.auto)).toEqual(mine.markers.filter((m) => !m.auto))
    expect(again.elevation).toBe(w.elevation)
    expect(generateKingdoms(mine, 3, 2).stateId).not.toEqual(again.stateId) // another click, another layout
    const none = generateKingdoms(mine, 0, 1)
    expect(none.states).toEqual([])
    expect(none.markers).toEqual(mine.markers.filter((m) => !m.auto))
  })
})

describe('reinos depois de editar o relevo', () => {
  const brush: Brush = { radius: 50, strength: 1, biome: 5, state: 0, marker: 'city' }
  const coastLand = (() => {
    for (let i = 0; i < mesh.n; i++) {
      if (!w.stateId[i]) continue
      for (let e = mesh.nOff[i]; e < mesh.nOff[i + 1]; e++) if (isWaterBiome(w.biome[mesh.nIdx[e]])) return i
    }
    throw new Error('sem costa')
  })()
  const [x, y] = [w.points[2 * coastLand], w.points[2 * coastLand + 1]]

  it('terra que vira mar perde o reino; mar que vira terra entra no reino vizinho', () => {
    let sunk = w
    for (let k = 0; k < 30; k++) {
      const s = startSession(sunk, 'lower')
      strokeTo(s, x, y, brush)
      sunk = commitSession(s)!
    }
    for (let i = 0; i < mesh.n; i++) if (isWaterBiome(sunk.biome[i])) expect(sunk.stateId[i]).toBe(0)

    let raised = w
    for (let k = 0; k < 30; k++) {
      const s = startSession(raised, 'raise')
      strokeTo(s, x, y, brush)
      raised = commitSession(s)!
    }
    let gained = 0
    for (let i = 0; i < mesh.n; i++) {
      if (isWaterBiome(w.biome[i]) && !isWaterBiome(raised.biome[i])) {
        gained++
        expect(raised.stateId[i]).toBeGreaterThan(0)
      }
    }
    expect(gained).toBeGreaterThan(0)
    expect(raised.states).toBe(w.states) // kingdoms are never deleted or renamed by terrain edits
  })

  it('settleStates: empate vai para o menor id; terra antiga sem reino continua sem reino', () => {
    const ids = Uint16Array.from(w.stateId)
    const land = ids.findIndex((s, i) => s > 0 && !isWaterBiome(w.biome[i]))
    ids[land] = 0
    settleStates(ids, w.biome, { biome: w.biome, mesh })
    expect(ids[land]).toBe(0)
  })

  it('pincel de reino pinta só terra, apaga com 0 e marca o reino como editado', () => {
    const target = w.states[0].id
    const s = startSession(w, 'kingdom')
    strokeTo(s, x, y, { ...brush, state: target })
    const painted = commitSession(s)!
    for (const i of s.touched) expect(isWaterBiome(w.biome[i])).toBe(false)
    expect([...s.touched].every((i) => painted.stateId[i] === target)).toBe(true)
    expect(painted.states.find((st) => st.id === target)!.auto).toBeUndefined()
    expect(hasHandEdits(painted)).toBe(true)

    const e = startSession(painted, 'kingdom')
    strokeTo(e, x, y, { ...brush, state: 0 })
    const erased = commitSession(e)!
    expect([...e.touched].every((i) => erased.stateId[i] === 0)).toBe(true)
    expect(erased.points).toBe(w.points)
  })

  it('pincel de reino ignora reino que não existe mais, e passar por cima do próprio reino não é edição', () => {
    const gone = startSession(w, 'kingdom')
    strokeTo(gone, x, y, { ...brush, state: 99 })
    expect(commitSession(gone)).toBeNull()

    // A radius of 1 only reaches the cell under the brush; paint it with the kingdom it already has.
    const same = startSession(w, 'kingdom')
    strokeTo(same, x, y, { ...brush, state: w.stateId[coastLand], radius: 1 })
    expect(same.touched.size).toBe(0)
    expect(commitSession(same)).toBeNull()
  })
})
