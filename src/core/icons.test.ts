import { describe, expect, it } from 'vitest'
import { ICON_GROUPS, iconDef, isIconSrc, MARKER_KINDS } from './icons'

describe('catálogo de ícones', () => {
  it('cada tipo está em exatamente um grupo e tem nome e formas válidas', () => {
    expect(ICON_GROUPS.flatMap((g) => g.kinds).sort()).toEqual([...MARKER_KINDS].sort())
    for (const k of MARKER_KINDS) {
      const def = iconDef(k)
      expect(def.name).toBeTruthy()
      expect(def.shapes.length).toBeGreaterThan(0)
      for (const [d, style] of def.shapes) {
        expect(d).toMatch(/^M[-\d.MLHVQAZahvlz ]+$/) // path commands only, no NaN
        expect(style).toMatch(/^[PIWS]+$/)
      }
    }
  })

  it('tipos antigos continuam existindo (mapas salvos antes abrem)', () => {
    expect(MARKER_KINDS).toEqual(expect.arrayContaining(['city', 'town', 'ruin', 'dungeon', 'poi']))
  })

  it('só aceita PNG ou WebP embutidos', () => {
    expect(isIconSrc('data:image/png;base64,iVBORw0KGgoAAAA')).toBe(true)
    expect(isIconSrc('data:image/webp;base64,UklGRgAAAA==')).toBe(true)
    expect(isIconSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isIconSrc('data:image/png;base64,iVBORw0KGgo AAAA')).toBe(false)
    expect(isIconSrc(42)).toBe(false)
  })
})
