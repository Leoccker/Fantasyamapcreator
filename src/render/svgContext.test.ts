import { beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../core/generate'
import { addMarker, patchItem } from '../core/items'
import { PathData } from './path'
import { asCanvas, esc, SvgContext } from './svgContext'

// Node has no Path2D; the recorder only needs it to exist (it reads paths back through makePath).
beforeAll(() => {
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      arc() {}
      rect() {}
      closePath() {}
    },
  )
})

const tags = (xml: string, re: RegExp) => xml.match(re)?.length ?? 0

describe('gravador SVG', () => {
  it('escapa texto do usuário e tira caracteres de controle', () => {
    expect(esc('<b>"Rei" & \'Rainha\'\x07')).toBe('&lt;b&gt;&quot;Rei&quot; &amp; &#39;Rainha&#39;')
  })

  it('arcos: círculo completo vira dois meios arcos; arco parcial liga no ponto atual', () => {
    const p = new PathData()
    p.arc(0, 0, 10, 0, Math.PI * 2)
    expect(p.d).toBe('M10 0A10 10 0 1 1 -10 0A10 10 0 1 1 10 0')
    const q = new PathData()
    q.moveTo(-10, 5)
    q.arc(0, 5, 10, Math.PI, 0)
    expect(q.d).toBe('M-10 5L-10 5A10 10 0 0 1 10 5')
  })

  it('transformações e recortes viram grupos que fecham no restore; rgba vira cor + opacidade', () => {
    const s = new SvgContext()
    const c = asCanvas(s)
    c.save()
    c.translate(5, 6)
    c.rotate(Math.PI / 2)
    c.beginPath()
    c.rect(0, 0, 10, 10)
    c.clip()
    c.fillStyle = 'rgba(10, 20, 30, 0.5)'
    c.globalAlpha = 0.5
    c.fillRect(0, 0, 1, 1)
    c.restore()
    c.fillRect(0, 0, 1, 1)
    const out = s.body()
    expect(out).toContain('translate(5 6)')
    expect(out).toContain('rotate(90)')
    expect(out).toContain('fill="rgb(10,20,30)" fill-opacity="0.25"')
    expect(tags(out, /<g /g)).toBe(3)
    expect(tags(out, /<\/g>/g)).toBe(3)
    expect(out.trim().endsWith('<rect x="0" y="0" width="1" height="1" fill="#000"/>')).toBe(true) // after restore: default paint
  })

  it('o mapa inteiro (linhas, marcadores, rótulos, grade, escala, rosa e moldura) grava sem NaN e com grupos fechados', async () => {
    const { drawLineWork, DEFAULT_LAYERS } = await import('./draw')
    const { drawAnnotations } = await import('./decor')
    const g = generate({ seed: 'svg', width: 600, height: 400, continents: 2, waterPct: 50, cellCount: 1500, kingdoms: 3 })
    const [m, sel] = addMarker(g, 'wizard_tower', 100, 100)
    const w = patchItem(m, sel, { name: '<Torre & "Cia">' })
    const layers = { ...DEFAULT_LAYERS, grid: true }
    const s = new SvgContext(2)
    drawLineWork(asCanvas(s), w, layers)
    drawAnnotations(asCanvas(s), w, { layers, textReady: true, pad: 24 })
    const out = s.body() + s.defsXml()
    expect(out).not.toMatch(/NaN|undefined|Infinity/)
    expect(tags(out, /<g /g)).toBe(tags(out, /<\/g>/g))
    expect(out).toContain('&lt;Torre &amp; &quot;Cia&quot;&gt;')
    expect(out).toContain('stroke-dasharray="6 4"') // kingdom borders
    expect(out).toContain('fill-rule="evenodd"') // frame ring
    expect(tags(out, /<text /g)).toBeGreaterThan(2 * w.markers.length) // halo + ink per name
  })
})
