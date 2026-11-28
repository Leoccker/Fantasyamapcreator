// Temporary visual highlights drawn over the map when the MCP AI modifies points, markers, labels, or brush strokes.
// Supports multiple simultaneous pulses (e.g. batch marker placements) and delays animation start until the first
// painted frame so terrain cache rebuilds never eat the visual feedback.
import { highlightCenter, type LiveHighlight } from '../core/liveProtocol'
import { INK, PAPER } from './palette'
import type { Overlay } from './renderer'

const DURATION_MS = 2800
const WAVE_DELAY = 0.22 // second staggered ripple wave
const GOLD_RGB = '245, 158, 11' // bright gold core
const VERMILION_RGB = '217, 72, 15' // high-contrast warm vermilion outer ring

interface PulseEntry {
  highlight: LiveHighlight
  startedAt: number | null
}

export interface LiveOverlay {
  overlay: Overlay
  pulse(highlights: LiveHighlight | LiveHighlight[]): void
  destroy(): void
}

function drawRippleWave(ctx: CanvasRenderingContext2D, x: number, y: number, baseR: number, maxGrow: number, progress: number, cssPx: number) {
  if (progress <= 0 || progress >= 1) return
  const eased = 1 - (1 - progress) * (1 - progress)
  const alpha = progress < 0.2 ? progress / 0.2 : Math.pow(1 - (progress - 0.2) / 0.8, 1.4)
  const r = baseR + eased * maxGrow

  // Dark contrast halo so the ring pops clearly over light parchment AND dark water
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.lineWidth = 6 * cssPx
  ctx.strokeStyle = `rgba(59, 42, 26, ${(0.45 * alpha).toFixed(3)})`
  ctx.stroke()

  // Bright golden-vermilion pulse ring
  ctx.lineWidth = 3 * cssPx
  ctx.strokeStyle = `rgba(${VERMILION_RGB}, ${(0.95 * alpha).toFixed(3)})`
  ctx.stroke()
}

export function createLiveOverlay(redraw: () => void): LiveOverlay {
  let entries: PulseEntry[] = []
  let raf = 0

  const tick = () => {
    raf = 0
    if (!entries.length) return
    const now = performance.now()
    entries = entries.filter((e) => e.startedAt === null || now - e.startedAt < DURATION_MS)
    redraw()
    if (entries.length) raf = requestAnimationFrame(tick)
  }

  const overlay: Overlay = (ctx) => {
    if (!entries.length) return
    const now = performance.now()
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    // Scale by CSS pixels (not device pixels) so rings and labels stay crisp and legible on 1x and 2x screens.
    const cssPx = dpr / ctx.getTransform().a

    ctx.save()
    for (const entry of entries) {
      if (entry.startedAt === null) entry.startedAt = now
      const elapsed = now - entry.startedAt
      const t = Math.max(0, Math.min(1, elapsed / DURATION_MS))
      if (t >= 1) continue
      // Hold strong visibility for the first 55%, then fade out smoothly.
      const fade = t < 0.55 ? 1 : Math.pow(1 - (t - 0.55) / 0.45, 1.6)
      const h = entry.highlight

      if (h.kind === 'stroke') {
        if (h.points.length > 0) {
          const pulseScale = 0.85 + 0.15 * Math.sin(t * Math.PI * 4)
          ctx.beginPath()
          ctx.moveTo(h.points[0].x, h.points[0].y)
          for (let i = 1; i < h.points.length; i++) ctx.lineTo(h.points[i].x, h.points[i].y)
          if (h.points.length === 1) ctx.arc(h.points[0].x, h.points[0].y, Math.max(1, h.radius), 0, Math.PI * 2)
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          if (h.points.length > 1) {
            ctx.lineWidth = Math.max(h.radius * 2, 12 * cssPx)
            ctx.strokeStyle = `rgba(${GOLD_RGB}, ${(0.28 * fade * pulseScale).toFixed(3)})`
            ctx.stroke()
          } else {
            ctx.fillStyle = `rgba(${GOLD_RGB}, ${(0.28 * fade * pulseScale).toFixed(3)})`
            ctx.fill()
          }
          ctx.lineWidth = 3 * cssPx
          ctx.setLineDash([8 * cssPx, 5 * cssPx])
          ctx.strokeStyle = `rgba(${VERMILION_RGB}, ${(0.95 * fade).toFixed(3)})`
          ctx.stroke()
          ctx.setLineDash([])

          const center = highlightCenter(h)
          drawRippleWave(ctx, center.x, center.y, Math.max(h.radius * 0.6, 12 * cssPx), 42 * cssPx, t, cssPx)
          drawRippleWave(ctx, center.x, center.y, Math.max(h.radius * 0.6, 12 * cssPx), 42 * cssPx, (t - WAVE_DELAY) / (1 - WAVE_DELAY), cssPx)
        }
      } else {
        const baseR = h.kind === 'area' ? Math.max(h.radius, 14 * cssPx) : 10 * cssPx

        // Warm glowing golden core
        ctx.beginPath()
        ctx.arc(h.x, h.y, baseR * (1 + 0.25 * Math.sin(t * Math.PI * 4)), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${GOLD_RGB}, ${(0.42 * fade).toFixed(3)})`
        ctx.fill()

        // Two staggered high-contrast expanding ripple waves
        drawRippleWave(ctx, h.x, h.y, baseR, 48 * cssPx, t, cssPx)
        drawRippleWave(ctx, h.x, h.y, baseR, 48 * cssPx, (t - WAVE_DELAY) / (1 - WAVE_DELAY), cssPx)
      }

      if (h.label) {
        const center = highlightCenter(h)
        const fontSize = 13 * cssPx
        const padX = 8 * cssPx
        const padY = 4 * cssPx
        const text = `IA · ${h.label}`
        ctx.font = `600 ${fontSize}px Georgia, serif`
        const w = ctx.measureText(text).width + padX * 2
        const boxH = fontSize + padY * 2
        const offsetY = (h.kind === 'stroke' ? Math.max(h.radius, 22 * cssPx) : 26 * cssPx) + 8 * cssPx
        const bx = center.x - w / 2
        const by = center.y - offsetY - boxH

        ctx.globalAlpha = Math.min(1, fade * 1.15)
        ctx.fillStyle = PAPER
        ctx.strokeStyle = `rgb(${VERMILION_RGB})`
        ctx.lineWidth = 2 * cssPx
        ctx.fillRect(bx, by, w, boxH)
        ctx.strokeRect(bx, by, w, boxH)
        ctx.fillStyle = INK
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, center.x, by + boxH / 2)
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()
  }

  return {
    overlay,
    pulse(input) {
      const list = Array.isArray(input) ? input : [input]
      if (!list.length) return
      // Keep up to 16 simultaneous pulses so batch placements all flash clearly without clutter.
      const added: PulseEntry[] = list.slice(-16).map((highlight) => ({ highlight, startedAt: null }))
      entries = [...entries.slice(-16 + added.length), ...added]
      if (!raf) raf = requestAnimationFrame(tick)
      redraw()
    },
    destroy() {
      entries = []
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    },
  }
}
