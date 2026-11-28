import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { addMarker } from './items'
import { describeLiveReason, highlightCenter, reuseUnchangedWorldData } from './liveProtocol'
import { parseWorld, serializeWorld } from './world'

describe('liveProtocol', () => {
  it('reuses unchanged typed arrays, rivers, and states after JSON round-trip', () => {
    const base = generate({ seed: 'proto-1', width: 1000, height: 625, cellCount: 1500, continents: 2, waterPct: 55, kingdoms: 3 })
    const [withMarker] = addMarker(base, 'city', 400, 300)
    const deserialized = parseWorld(serializeWorld(withMarker))

    // parseWorld normally allocates new typed arrays
    expect(deserialized.points).not.toBe(base.points)

    const merged = reuseUnchangedWorldData(base, deserialized)
    expect(merged.points).toBe(base.points)
    expect(merged.elevation).toBe(base.elevation)
    expect(merged.biome).toBe(base.biome)
    expect(merged.biomeOverride).toBe(base.biomeOverride)
    expect(merged.stateId).toBe(base.stateId)
    expect(merged.rivers).toBe(base.rivers)
    expect(merged.states).toBe(base.states)
    expect(merged.markers.length).toBe(base.markers.length + 1)
  })

  it('replaces changed arrays while still keeping unchanged points when terrain changes', () => {
    const base = generate({ seed: 'proto-2', width: 1000, height: 625, cellCount: 1500, continents: 2, waterPct: 55, kingdoms: 2 })
    const deserialized = parseWorld(serializeWorld(base))
    deserialized.elevation[0] = deserialized.elevation[0] > 0.5 ? 0.1 : 0.9

    const merged = reuseUnchangedWorldData(base, deserialized)
    expect(merged.points).toBe(base.points)
    expect(merged.elevation).not.toBe(base.elevation)
    expect(merged.biome).toBe(base.biome)
  })

  it('computes highlightCenter and friendly descriptions', () => {
    expect(highlightCenter({ kind: 'point', x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(highlightCenter({ kind: 'area', x: 50, y: 60, radius: 30 })).toEqual({ x: 50, y: 60 })
    expect(
      highlightCenter({
        kind: 'stroke',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        radius: 20,
      }),
    ).toEqual({ x: 50, y: 20 })

    expect(describeLiveReason('manage_markers', { kind: 'point', x: 0, y: 0, label: 'Porto Sul' })).toContain('Porto Sul')
    expect(describeLiveReason('generate_world')).toContain('novo mapa')
  })
})
