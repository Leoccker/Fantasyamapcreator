import { BIOME_NAMES, type Biome } from '../core/biomes'
import { BIOME_COLORS } from '../render/palette'

const LAND_BIOMES = (Object.keys(BIOME_COLORS).map(Number) as Biome[]).map((b) => [b, BIOME_COLORS[b]!] as const)

/** Swatches for the land biomes that have a color (titled by its Section in the panel). */
export function BiomeLegend() {
  return (
    <ul className="legend">
      {LAND_BIOMES.map(([b, color]) => (
        <li key={b}>
          <span className="swatch" style={{ background: color }} aria-hidden="true" />
          {BIOME_NAMES[b]}
        </li>
      ))}
    </ul>
  )
}
