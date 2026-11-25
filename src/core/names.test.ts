import { describe, expect, it } from 'vitest'
import { makeNamer } from './names'
import { rngFor } from './rng'

describe('nomes', () => {
  it('mesma seed dá os mesmos nomes', () => {
    const a = makeNamer(rngFor('x', 'n'))
    const b = makeNamer(rngFor('x', 'n'))
    for (const k of ['state', 'city', 'sea', 'city'] as const) expect(a(k)).toBe(b(k))
  })

  it('300 nomes de cada tipo, todos diferentes e não vazios', () => {
    const name = makeNamer(rngFor('y', 'n'))
    for (const k of ['state', 'city', 'sea'] as const) {
      const got = Array.from({ length: 300 }, () => name(k))
      expect(new Set(got.map((g) => g.toLowerCase())).size).toBe(300)
      expect(got.every((g) => g.trim().length > 1)).toBe(true)
    }
  })

  it('nunca repete um nome já usado, sem diferenciar maiúsculas', () => {
    const first = makeNamer(rngFor('z', 'n'))('city')
    const again = makeNamer(rngFor('z', 'n'), [first.toUpperCase()])('city')
    expect(again.toLowerCase()).not.toBe(first.toLowerCase())
  })
})
