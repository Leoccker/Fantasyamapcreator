import { addLabel, addMarker } from '../../core/items'
import type { GestureEnv } from './types'

/** A click adds a marker or label (one undo step) and selects it so the panel can edit it. */
export function placeItem(env: GestureEnv, what: 'marker' | 'label', x: number, y: number): void {
  const [w, sel] = what === 'marker' ? addMarker(env.world(), env.brush().marker, x, y, env.brush().icon) : addLabel(env.world(), x, y)
  env.commit(w, what === 'marker' ? 'Marcador criado.' : 'Rótulo criado.')
  env.select(sel)
}
