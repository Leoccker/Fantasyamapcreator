import { LAYERS, type LayerId, type Layers } from '../render/draw'

interface Props {
  layers: Layers
  onChange(layers: Layers): void
}

export function LayerToggles({ layers, onChange }: Props) {
  return (
    <div className="layers">
      {(Object.keys(LAYERS) as LayerId[]).map((id) => (
        <label key={id} className="check">
          <input type="checkbox" checked={layers[id]} onChange={(e) => onChange({ ...layers, [id]: e.target.checked })} />
          {LAYERS[id]}
        </label>
      ))}
    </div>
  )
}
