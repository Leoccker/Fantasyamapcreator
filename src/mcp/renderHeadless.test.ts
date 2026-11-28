import { describe, expect, it } from 'vitest'
import { generate } from '../core/generate'
import { addIcon, addMarker } from '../core/items'
import { patchSettings } from '../core/settings'
import { renderWorldPng, renderWorldSvg } from './renderHeadless'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Minimal valid 1x1 PNG data URL to verify uploaded icons do not crash headless rendering in Node.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('renderHeadless', () => {
  const base = patchSettings(
    generate({ seed: 'render-test', width: 1000, height: 625, cellCount: 3000, continents: 2, waterPct: 58, kingdoms: 3 }),
    { title: 'Reino de Eldoria' },
  )

  it('renders a standalone SVG with map layers, title, and the uploaded custom icon', () => {
    const withIcon = addIcon(base, 'Brasão', TINY_PNG)!
    const [world] = addMarker(withIcon[0], 'castle', 500, 300, withIcon[1])

    const svg = renderWorldSvg(world, { layers: { tint: true, grid: true } })
    expect(svg.startsWith('<?xml version="1.0"')).toBe(true)
    expect(svg).toContain('<svg ')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Reino de Eldoria')
    expect(svg).toContain('mcpLandClip')
    expect(svg).toContain(`xlink:href="${TINY_PNG}"`) // the uploaded icon, not the kind's fallback
  })

  it('rasterizes a valid PNG buffer at requested maxWidth', () => {
    const { png, width, height } = renderWorldPng(base, { maxWidth: 640 })
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true)
    expect(width).toBe(640)
    expect(height).toBeGreaterThan(300)
    expect(png.byteLength).toBeGreaterThan(5_000)
  })
})
