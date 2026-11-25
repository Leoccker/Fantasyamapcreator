import { commitSession, startSession, strokeTo, type BrushTool } from '../../core/brush'
import type { Gesture, GestureEnv } from './types'

/**
 * A brush stroke. The stroke so far is shown as a real map (coast, biomes, rivers, kingdoms) at most once per
 * frame, and becomes one undo step on release.
 */
export function startStroke(env: GestureEnv, tool: BrushTool, x: number, y: number): Gesture {
  const session = startSession(env.world(), tool)
  let frame = 0
  let previewed = false // the renderer shows a preview instead of the committed world

  const stale = () => session.base !== env.world() // the map changed mid-drag (e.g. Ctrl+Z)
  const showLive = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (stale()) return
      const preview = commitSession(session) // not in history; the real commit happens on release
      if (!preview) return
      env.renderer()?.setWorld(preview)
      previewed = true
    })
  }

  strokeTo(session, x, y, env.brush())
  showLive()

  return {
    move(x, y) {
      if (stale()) return
      strokeTo(session, x, y, env.brush())
      showLive()
    },
    end(commit) {
      cancelAnimationFrame(frame)
      const w = commit && !stale() ? commitSession(session) : null
      // App re-renders with the committed world; otherwise put back the map the preview replaced.
      if (w) env.commit(w)
      else if (previewed) env.renderer()?.setWorld(env.world())
    },
  }
}
