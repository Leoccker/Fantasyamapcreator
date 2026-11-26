// Map symbols in hand-drawn ink style. placeSymbols() is pure and deterministic per seed.
import { Biome, isWaterBiome, relAltitude } from '../core/biomes'
import type { Mesh } from '../core/mesh'
import { rngFor } from '../core/rng'
import type { World } from '../core/world'
import { PAPER, TREE_FILL } from './palette'

export type SymbolKind = 'mountain' | 'hill' | 'conifer' | 'tree' | 'swamp' | 'dunes' | 'grass'

export interface MapSymbol {
  kind: SymbolKind
  x: number
  y: number
  size: number
}

interface SymbolRule {
  kind: SymbolKind
  /** Chance a cell gets the symbol. */
  chance: number
  /** Minimum distance to other symbols, as a fraction of symbol size. */
  gap: number
}
const MOUNTAIN: SymbolRule = { kind: 'mountain', chance: 0.6, gap: 0.8 }
const HILL: SymbolRule = { kind: 'hill', chance: 0.45, gap: 0.9 }
const BY_BIOME: Partial<Record<Biome, SymbolRule>> = {
  [Biome.Forest]: { kind: 'tree', chance: 0.75, gap: 0.9 },
  [Biome.Taiga]: { kind: 'conifer', chance: 0.75, gap: 0.9 },
  [Biome.Swamp]: { kind: 'swamp', chance: 0.45, gap: 1.2 },
  [Biome.Desert]: { kind: 'dunes', chance: 0.18, gap: 1.4 },
  [Biome.Grassland]: { kind: 'grass', chance: 0.12, gap: 1 },
}
const SIZE: Record<SymbolKind, number> = { mountain: 11, hill: 9, conifer: 6, tree: 6, swamp: 6, dunes: 6, grass: 6 }

/** Picks symbols per cell, skipping coasts and river cells, without overlaps; sorted back to front. */
export function placeSymbols(world: World, mesh: Mesh): MapSymbol[] {
  const rng = rngFor(world.seed, 'symbols')
  const onRiver = new Uint8Array(mesh.n)
  for (const r of world.rivers) for (const c of r.cells) onRiver[c] = 1

  const out: MapSymbol[] = []
  const grid = new Map<string, MapSymbol[]>()
  const G = 24 // collision grid cell size, in map pixels
  const cellKey = (gx: number, gy: number) => gx + ',' + gy
  const fits = (s: MapSymbol, gap: number) => {
    const gx = Math.floor(s.x / G)
    const gy = Math.floor(s.y / G)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const o of grid.get(cellKey(gx + dx, gy + dy)) ?? [])
          if (Math.abs(o.x - s.x) < gap * Math.max(o.size, s.size) && Math.abs(o.y - s.y) < 0.6 * gap * Math.max(o.size, s.size)) return false
    return true
  }

  const touchesWater = (i: number) => {
    for (let k = mesh.nOff[i]; k < mesh.nOff[i + 1]; k++) if (isWaterBiome(world.biome[mesh.nIdx[k]])) return true
    return false
  }

  for (let i = 0; i < mesh.n; i++) {
    const b = world.biome[i] as Biome
    // Draw a random number for every cell, so changing one cell's symbol doesn't reshuffle the rest.
    const roll = rng()
    const jx = rng() - 0.5
    const jy = rng() - 0.5
    const vary = 0.75 + rng() * 0.5
    if (isWaterBiome(b) || onRiver[i]) continue
    const rel = relAltitude(world.elevation[i], world.seaLevel)
    const rule = rel > 0.6 ? MOUNTAIN : rel > 0.4 ? HILL : touchesWater(i) ? undefined : BY_BIOME[b]
    if (!rule || roll > rule.chance) continue

    const { kind } = rule
    const size = (kind === 'mountain' ? SIZE.mountain + rel * 14 : SIZE[kind]) * vary
    const s = { kind, x: world.points[2 * i] + jx * 6, y: world.points[2 * i + 1] + jy * 6, size }
    if (!fits(s, rule.gap)) continue
    out.push(s)
    const k = cellKey(Math.floor(s.x / G), Math.floor(s.y / G))
    const bucket = grid.get(k)
    if (bucket) bucket.push(s)
    else grid.set(k, [s])
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Draws one symbol with its base at (x, y). Fills with paper first so it hides what is behind it. */
export function drawSymbol(ctx: CanvasRenderingContext2D, s: MapSymbol): void {
  const { x, y, size: h } = s
  ctx.beginPath()
  switch (s.kind) {
    case 'mountain': {
      const w = h * 1.3
      ctx.moveTo(x - w / 2, y)
      ctx.lineTo(x - w * 0.08, y - h)
      ctx.lineTo(x + w / 2, y)
      ctx.fillStyle = PAPER
      ctx.fill()
      ctx.stroke()
      // Shaded east face.
      ctx.beginPath()
      ctx.moveTo(x - w * 0.08, y - h)
      ctx.lineTo(x + w / 2, y)
      ctx.lineTo(x + w * 0.05, y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(59, 42, 26, 0.28)'
      ctx.fill()
      break
    }
    case 'hill': {
      const w = h * 1.4
      ctx.moveTo(x - w / 2, y)
      ctx.quadraticCurveTo(x, y - h * 1.1, x + w / 2, y)
      ctx.fillStyle = PAPER
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + w * 0.1, y - h * 0.35)
      ctx.quadraticCurveTo(x + w * 0.3, y - h * 0.2, x + w * 0.38, y)
      ctx.stroke()
      break
    }
    case 'conifer':
      ctx.moveTo(x, y - h * 1.6)
      ctx.lineTo(x + h * 0.45, y - h * 0.2)
      ctx.lineTo(x - h * 0.45, y - h * 0.2)
      ctx.closePath()
      ctx.fillStyle = TREE_FILL
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y - h * 0.2)
      ctx.lineTo(x, y)
      ctx.stroke()
      break
    case 'tree':
      ctx.arc(x, y - h * 0.85, h * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = TREE_FILL
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y - h * 0.35)
      ctx.lineTo(x, y)
      ctx.stroke()
      break
    case 'swamp':
      for (const dy of [0, 3]) {
        ctx.moveTo(x - h * 0.6 + dy, y - dy)
        ctx.lineTo(x + h * 0.6 + dy, y - dy)
      }
      ctx.moveTo(x - 1, y - 3)
      ctx.lineTo(x - 2, y - 7)
      ctx.moveTo(x + 1, y - 3)
      ctx.lineTo(x + 2, y - 6)
      ctx.stroke()
      break
    case 'dunes':
      ctx.moveTo(x - h, y)
      ctx.quadraticCurveTo(x - h / 2, y - h * 0.6, x, y)
      ctx.moveTo(x - h * 0.2, y - h * 0.2)
      ctx.quadraticCurveTo(x + h * 0.3, y - h * 0.8, x + h * 0.8, y - h * 0.2)
      ctx.stroke()
      break
    case 'grass':
      ctx.moveTo(x - 2, y - 4)
      ctx.lineTo(x, y)
      ctx.lineTo(x + 2, y - 4)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y - 5)
      ctx.stroke()
      break
  }
}

