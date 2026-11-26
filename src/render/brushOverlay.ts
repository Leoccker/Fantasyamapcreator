// The brush circle drawn over the map. Cheap by design (no drawWorld), so it can run on every pointer move.
import { INK } from './palette'
import type { Overlay } from './renderer'

export interface BrushOverlay {
  overlay: Overlay
  /** World position and radius of the brush circle (dashed: it takes away instead of painting), or null to hide it. */
  setCursor(c: BrushCursor | null): void
}

type BrushCursor = { x: number; y: number; r: number; dashed?: boolean }

export function createBrushOverlay(): BrushOverlay {
  let cursor: BrushCursor | null = null

  const overlay: Overlay = (ctx) => {
    if (!cursor) return
    // Constant on-screen line width whatever the zoom.
    const px = 1 / ctx.getTransform().a
    ctx.beginPath()
    ctx.arc(cursor.x, cursor.y, cursor.r, 0, Math.PI * 2)
    ctx.lineWidth = 3 * px
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.8)'
    ctx.stroke()
    ctx.lineWidth = 1.5 * px
    ctx.strokeStyle = INK
    if (cursor.dashed) ctx.setLineDash([6 * px, 4 * px])
    ctx.stroke()
    ctx.setLineDash([])
  }

  return {
    overlay,
    setCursor(c) {
      cursor = c
    },
  }
}
