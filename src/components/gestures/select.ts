import { findItem, hitTest, moveItem } from '../../core/items'
import type { Gesture, GestureEnv } from './types'

const HIT_PX = 6 // extra hit area around items, in screen pixels
const DRAG_PX = 3 // a click that moves less than this is not a drag

/**
 * Click selects what is under the pointer (marker, label or kingdom); dragging a marker or label moves it.
 * While dragging only the renderer's overlay moves (no map rebuild); release commits one undo step.
 */
export function startSelect(env: GestureEnv, x: number, y: number): Gesture | null {
  const base = env.world()
  const hit = hitTest(base, x, y, HIT_PX * env.worldPerPx())
  env.select(hit)
  if (!hit || hit.type === 'state') return null

  const item = findItem(base, hit) as { x: number; y: number }
  const [offX, offY] = [item.x - x, item.y - y]
  let to: { x: number; y: number } | null = null

  const clearDrag = () => env.renderer()?.setDrag(null)
  return {
    move(px, py) {
      if (env.world() !== base) return clearDrag()
      if (!to && Math.hypot(px - x, py - y) < DRAG_PX * env.worldPerPx()) return
      to = { x: px + offX, y: py + offY }
      env.renderer()?.setDrag({ sel: hit, ...to })
    },
    end(commit) {
      const moved = commit && to && env.world() === base ? moveItem(base, hit, to.x, to.y) : base
      if (moved === base) return clearDrag()
      env.commit(moved, 'Movido.') // the renderer drops the drag when this world arrives: no flicker
    },
  }
}
