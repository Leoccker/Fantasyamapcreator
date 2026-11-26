import type { Brush } from '../../core/brush'
import type { Sel } from '../../core/items'
import type { World } from '../../core/world'
import type { Renderer } from '../../render/renderer'

/** What a gesture can see and do. Getters always return the latest values. */
export interface GestureEnv {
  world(): World
  brush(): Brush
  renderer(): Renderer | null
  /** Records an edit (one undo step) with a status message. */
  commit(w: World, msg?: string): void
  select(s: Sel | null): void
  /** Map units per CSS pixel at the current zoom, for hit areas that feel the same at any zoom. */
  worldPerPx(): number
}

/** A pointer drag in progress. Positions are in map units. */
export interface Gesture {
  move(x: number, y: number): void
  /** commit = false cancels (Esc, pointer cancel). */
  end(commit: boolean): void
}
