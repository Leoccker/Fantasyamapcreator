import { describe, expect, it } from 'vitest'
import { centerOn, framePad, HOME, screenToWorld, transform, zoomAt, ZOOM_MAX, ZOOM_MIN } from './view'

const [W, H, cw, ch] = [1600, 1000, 900, 700]

describe.each([0, 60])('view com margem %i', (P) => {
  it('screenToWorld desfaz o transform', () => {
    const v = { x: 37, y: -12, zoom: 2.5 }
    const { s, ox, oy } = transform(v, W, H, P, cw, ch)
    const [wx, wy] = [523, 711]
    const [x, y] = screenToWorld(v, W, H, P, cw, ch, ox + s * wx, oy + s * wy)
    expect(x).toBeCloseTo(wx, 9)
    expect(y).toBeCloseTo(wy, 9)
  })

  it('zoom mantém fixo o ponto do mapa embaixo do cursor', () => {
    const [px, py] = [610, 222]
    const before = screenToWorld(HOME, W, H, P, cw, ch, px, py)
    const v = zoomAt(HOME, W, H, P, cw, ch, px, py, 3)
    const after = screenToWorld(v, W, H, P, cw, ch, px, py)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
  })

  it('zoom fica entre os limites', () => {
    expect(zoomAt(HOME, W, H, P, cw, ch, 0, 0, 1000).zoom).toBe(ZOOM_MAX)
    expect(zoomAt(HOME, W, H, P, cw, ch, 0, 0, 0.001).zoom).toBe(ZOOM_MIN)
  })

  it('centerOn põe o ponto do mapa no meio da tela', () => {
    const v = centerOn(HOME, W, H, P, cw, ch, 300, 700)
    const [x, y] = screenToWorld(v, W, H, P, cw, ch, cw / 2, ch / 2)
    expect(x).toBeCloseTo(300, 9)
    expect(y).toBeCloseTo(700, 9)
    expect(v.zoom).toBe(2)
  })

  it('na vista inicial a folha inteira (mapa + margem) cabe no canvas', () => {
    const { s, ox, oy } = transform(HOME, W, H, P, cw, ch)
    expect(ox - P * s).toBeGreaterThanOrEqual(-1e-9)
    expect(ox + (W + P) * s).toBeLessThanOrEqual(cw + 1e-9)
    expect(oy - P * s).toBeGreaterThanOrEqual(-1e-9)
    expect(oy + (H + P) * s).toBeLessThanOrEqual(ch + 1e-9)
  })
})

it('a margem da moldura é zero quando a moldura está desligada', () => {
  expect(framePad({ width: W, height: H }, false)).toBe(0)
  expect(framePad({ width: W, height: H }, true)).toBeGreaterThan(0)
})
