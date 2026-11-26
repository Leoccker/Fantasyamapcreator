import { gridCellUnits } from '../core/grid'
import { CORNER_NAMES, CORNERS, GRID_TYPE_NAMES, GRID_TYPES, SETTINGS_LIMITS, type Corner, type GridType, type MapSettings } from '../core/settings'
import type { World } from '../core/world'
import { DraftInput } from './DraftInput'

const HINT_ID = 'map-settings-hint'

interface Props {
  world: World
  onPatch(p: Partial<MapSettings>): void
}

/** Grid, scale and frame settings of the current map (saved with it; each change is one undo step). */
export function MapSettingsPanel({ world, onPatch }: Props) {
  const s = world.settings
  const grid = gridCellUnits(s, world.width, world.height)
  const cornerSelect = (label: string, value: Corner, key: 'scaleCorner' | 'compassCorner') => (
    <label>
      {label}
      <select value={value} onChange={(e) => onPatch({ [key]: e.target.value as Corner })}>
        {CORNERS.map((c) => (
          <option key={c} value={c}>
            {CORNER_NAMES[c]}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <fieldset className="map-settings">
      <legend>Mapa</legend>
      <DraftInput label="Título da moldura (vazio = seed)" value={s.title} maxLength={SETTINGS_LIMITS.title} onCommit={(title) => onPatch({ title })} />
      <div className="row">
        <DraftInput label="Escala (km por unidade)" type="number" value={String(s.kmPerUnit)} describedBy={HINT_ID} onCommit={(v) => onPatch({ kmPerUnit: Number(v) })} />
        <label>
          Grade
          <select value={s.gridType} onChange={(e) => onPatch({ gridType: e.target.value as GridType })}>
            {GRID_TYPES.map((t) => (
              <option key={t} value={t}>
                {GRID_TYPE_NAMES[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DraftInput label="Tamanho da célula (km)" type="number" value={String(s.gridKm)} describedBy={HINT_ID} onCommit={(v) => onPatch({ gridKm: Number(v) })} />
      {/* Live, so "grade ajustada" is announced when a size gets clamped. */}
      <p className="hint" id={HINT_ID} aria-live="polite">
        Mapa de {Math.round(world.width * s.kmPerUnit).toLocaleString('pt-BR')} × {Math.round(world.height * s.kmPerUnit).toLocaleString('pt-BR')} km.
        {grid.clamped && ` Grade ajustada para ${(grid.size * s.kmPerUnit).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km (menor que isso fica ilegível).`}
      </p>
      <div className="row">
        {cornerSelect('Barra de escala', s.scaleCorner, 'scaleCorner')}
        {cornerSelect('Rosa dos ventos', s.compassCorner, 'compassCorner')}
      </div>
    </fieldset>
  )
}
