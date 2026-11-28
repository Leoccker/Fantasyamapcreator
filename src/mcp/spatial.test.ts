import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Biome, relAltitude } from '../core/biomes'
import { generate } from '../core/generate'
import { addMarker, patchItem } from '../core/items'
import { getMesh, isLand } from '../core/mesh'
import { inBox, overlayBoxes } from '../core/settings'
import { MapSession, resolveSafePath } from './session'
import { findLocations, inspectWorld, parseBiome, parseLandBiome, samplePoint } from './spatial'

const makeWorld = (seed = 'spatial-test') =>
  generate({ seed, width: 1000, height: 625, cellCount: 3000, continents: 2, waterPct: 55, kingdoms: 4 })

describe('MapSession & resolveSafePath', () => {
  it('tracks undo/redo and skips no-op edits', () => {
    const s = new MapSession()
    expect(() => s.requireWorld()).toThrow(/Nenhum mapa ativo/)

    const w = makeWorld()
    s.setWorld(w)
    expect(s.status()).toEqual({ hasWorld: true, filePath: null, canUndo: false, canRedo: false })

    // No-op edit should not push history
    expect(s.edit((cur) => cur).changed).toBe(false)
    expect(s.status().canUndo).toBe(false)

    // Real edit pushes history
    const { changed } = s.edit((cur) => addMarker(cur, 'city', 500, 300)[0])
    expect(changed).toBe(true)
    expect(s.world?.markers.length).toBe(w.markers.length + 1)
    expect(s.status().canUndo).toBe(true)

    expect(s.undo().changed).toBe(true)
    expect(s.world?.markers.length).toBe(w.markers.length)
    expect(s.status().canRedo).toBe(true)

    expect(s.redo().changed).toBe(true)
    expect(s.world?.markers.length).toBe(w.markers.length + 1)
  })

  it('enforces rootDir jail in resolveSafePath', () => {
    const root = path.resolve('/tmp/map-jail')
    expect(resolveSafePath('maps/a.json', root)).toBe(path.join(root, 'maps/a.json'))
    expect(() => resolveSafePath('../escape.json', root)).toThrow(/fora do diretório permitido/)
    expect(() => resolveSafePath('/etc/passwd', root)).toThrow(/fora do diretório permitido/)
  })
})

describe('spatial queries', () => {
  const w = makeWorld()

  it('parses biomes by key and Portuguese name', () => {
    expect(parseBiome('Forest')).toBe(Biome.Forest)
    expect(parseBiome('magicforest')).toBe(Biome.MagicForest)
    expect(parseBiome('Floresta mágica')).toBe(Biome.MagicForest)
    expect(parseBiome('Ocean')).toBe(Biome.Ocean)
    expect(parseLandBiome('Ocean')).toBeNull()
    expect(parseLandBiome('Desert')).toBe(Biome.Desert)
  })

  it('inspectWorld produces consistent counts, true territory center, capitalPos, and overlays', () => {
    const summary = inspectWorld(w)
    expect(summary.meta.landCells + summary.meta.waterCells).toBe(summary.meta.cellCount)
    expect(summary.meta.oceanCells + summary.meta.lakeCells).toBe(summary.meta.waterCells)
    expect(summary.kingdoms.length).toBe(w.states.length)
    expect(summary.kingdoms.every((k) => k.cells > 0 && k.center !== null && k.capitalPos !== null)).toBe(true)
    expect(summary.biomes.reduce((acc, b) => acc + b.cells, 0)).toBe(summary.meta.cellCount)
    expect(summary.overlays.compass.corner).toBe(w.settings.compassCorner)
    expect(summary.overlays.scaleBar.corner).toBe(w.settings.scaleCorner)

    // Moving a capital far from the territory must NOT move the kingdom's territory center.
    const st = w.states[0]
    const moved = patchItem(w, { type: 'marker', id: st.capital! }, { x: 10, y: 10 })
    const after = inspectWorld(moved)
    const beforeK = summary.kingdoms.find((k) => k.id === st.id)!
    const afterK = after.kingdoms.find((k) => k.id === st.id)!
    expect(afterK.center).toEqual(beforeK.center)
    expect(afterK.capitalPos).toEqual({ x: 10, y: 10 })
  })

  it('findLocations avoids compass and scale bar overlays by default', () => {
    const boxes = overlayBoxes(w)
    const res = findLocations(w, { terrain: 'any', limit: 20 })
    for (const loc of res.locations) {
      expect(inBox(loc.x, loc.y, boxes.compass)).toBe(false)
      expect(inBox(loc.x, loc.y, boxes.scaleBar)).toBe(false)
    }
  })

  it('samplePoint inspects cell terrain and nearest markers', () => {
    const cap = w.markers.find((m) => m.kind === 'capital')!
    const sample = samplePoint(w, cap.x, cap.y)
    expect(sample.isLand).toBe(true)
    expect(sample.kingdom).not.toBeNull()
    expect(sample.nearestMarkers[0].id).toBe(cap.id)
    expect(sample.nearestMarkers[0].distance).toBe(0)
  })

  it('findLocations locates valid coast, mountain, river_mouth and kingdom border cells', () => {
    const mesh = getMesh(w)

    const coasts = findLocations(w, { terrain: 'coast', limit: 5 })
    expect(coasts.locations.length).toBeGreaterThan(0)
    for (const loc of coasts.locations) {
      expect(isLand(w, loc.cell)).toBe(true)
      expect(loc.isCoast).toBe(true)
    }

    const mountains = findLocations(w, { terrain: 'mountain', limit: 3 })
    expect(mountains.locations.length).toBeGreaterThan(0)
    for (const loc of mountains.locations) {
      expect(relAltitude(w.elevation[loc.cell], w.seaLevel)).toBeGreaterThanOrEqual(0.55)
    }

    if (w.rivers.length > 0) {
      const mouths = findLocations(w, { terrain: 'river_mouth', limit: 3 })
      expect(mouths.locations.length).toBeGreaterThan(0)
      for (const loc of mouths.locations) expect(isLand(w, loc.cell)).toBe(true)
    }

    // Find a pair of neighboring kingdoms from inspectWorld and query their shared border.
    const summary = inspectWorld(w)
    const withNeighbor = summary.kingdoms.find((k) => k.neighbors.length > 0)
    if (withNeighbor) {
      const pair: [number, number] = [withNeighbor.id, withNeighbor.neighbors[0]]
      const border = findLocations(w, { borderOfKingdoms: pair, limit: 4 })
      expect(border.locations.length).toBeGreaterThan(0)
      for (const loc of border.locations) {
        expect(pair).toContain(w.stateId[loc.cell])
        const touchesOther = Array.from(mesh.nIdx.subarray(mesh.nOff[loc.cell], mesh.nOff[loc.cell + 1])).some(
          (j) => isLand(w, j) && w.stateId[j] === (w.stateId[loc.cell] === pair[0] ? pair[1] : pair[0]),
        )
        expect(touchesOther).toBe(true)
      }
    }
  })

  it('respects minDistanceFromMarkers filter', () => {
    const res = findLocations(w, { terrain: 'land', minDistanceFromMarkers: 80, limit: 5 })
    for (const loc of res.locations) {
      for (const m of w.markers) {
        expect(Math.hypot(m.x - loc.x, m.y - loc.y)).toBeGreaterThanOrEqual(79.9)
      }
    }
  })
})
