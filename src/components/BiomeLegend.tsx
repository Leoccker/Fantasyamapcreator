import { BIOME_NAMES, LAND_BIOMES } from '../core/biomes'
import { BIOME_COLORS } from '../render/palette'

/** Swatches for the land biomes that have a color (titled by its Section in the panel). */
export function BiomeLegend() {
  return (
    <ul className="legend">
      {LAND_BIOMES.map((b) => (
        <li key={b}>
          <span className="swatch" style={{ background: BIOME_COLORS[b] }} aria-hidden="true" />
          {BIOME_NAMES[b]}
        </li>
      ))}
    </ul>
  )
}
