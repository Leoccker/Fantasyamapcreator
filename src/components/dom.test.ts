import { describe, expect, it } from 'vitest'
import { parseNumber } from './dom'

describe('parseNumber', () => {
  it('aceita vírgula decimal e recusa texto inválido', () => {
    expect(['0,5', ' 12.25 ', '-3', '1e3'].map(parseNumber)).toEqual([0.5, 12.25, -3, 1000])
    expect(['', '  ', 'abc', '1,2,3', 'Infinity'].map(parseNumber)).toEqual([null, null, null, null, null])
  })
})
