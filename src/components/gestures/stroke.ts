import { commitSession, drainFresh, previewSession, startSession, strokeTo, type BrushTool } from '../../core/brush'
import type { Gesture, GestureEnv } from './types'

/**
 * A brush stroke (`shrink`: the kingdom tool takes cells away instead of painting). The stroke so far is previewed
 * at most once per frame, redrawing only around the cells that changed (terrain tools skip rivers, lakes and biomes
 * until release); it becomes one undo step on release, which renders the real map.
 */
export function startStroke(env: GestureEnv, tool: BrushTool, x: number, y: number, shrink = false): Gesture {
  const session = startSession(env.world(), tool, shrink)
  let frame = 0
  let previewed = false // the renderer shows a preview instead of the committed world

  const stale = () => session.base !== env.world() // the map changed mid-drag (e.g. Ctrl+Z)
  const showLive = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (stale()) return
      const cells = drainFresh(session) // everything changed since the last frame drawn
      const preview = cells.length ? previewSession(session) : null // not in history; the real commit is on release
      if (!preview) return
      env.renderer()?.preview(preview, cells)
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
