import { useEffect, useRef } from 'react'
import type { LiveHighlight } from '../core/liveProtocol'
import type { Layers } from '../render/draw'
import { createLiveOverlay, type LiveOverlay } from '../render/liveOverlay'
import { createRenderer, type Renderer } from '../render/renderer'
import { framePad } from '../render/view'
import { useMapInteraction, type MapInteractionOptions } from './useMapInteraction'

export type LivePulse = { highlights: LiveHighlight[]; n: number }

type Props = Omit<MapInteractionOptions, 'pad'> & { layers: Layers; livePulse?: LivePulse | null }

/** Owns the imperative canvas renderer; React only tells it what to show. */
export function MapCanvas({ layers, livePulse, ...interaction }: Props) {
  const { world, selection } = interaction
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const liveOverlayRef = useRef<LiveOverlay | null>(null)

  // Declared first so it runs before useMapInteraction's effects, which need the renderer.
  useEffect(() => {
    const r = createRenderer(canvasRef.current!, layers)
    const liveOverlay = createLiveOverlay(() => r.draw())
    const removeLive = r.addOverlay(liveOverlay.overlay)
    rendererRef.current = r
    liveOverlayRef.current = liveOverlay
    return () => {
      removeLive()
      liveOverlay.destroy()
      liveOverlayRef.current = null
      r.destroy()
      rendererRef.current = null
    }
    // Created once; world/layers are pushed by the effects below.
  }, [])

  const { zoom } = useMapInteraction(canvasRef, rendererRef, { ...interaction, layers, pad: framePad(world, layers.frame) })

  useEffect(() => {
    if (livePulse?.highlights.length) liveOverlayRef.current?.pulse(livePulse.highlights)
  }, [livePulse])

  useEffect(() => {
    rendererRef.current?.setWorld(world)
  }, [world])

  useEffect(() => {
    rendererRef.current?.setLayers(layers)
  }, [layers])

  useEffect(() => {
    rendererRef.current?.setSelection(selection)
  }, [selection])

  return (
    <main className="map-area">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        role="img"
        aria-label={`Mapa do mundo “${world.seed}”. Setas movem, + e − dão zoom, 0 volta ao mapa inteiro.`}
      />
      <div className="zoom-controls" role="group" aria-label="Zoom do mapa">
        <button type="button" onClick={() => zoom('in')} aria-label="Aumentar zoom" title="Aumentar zoom (+)">
          +
        </button>
        <button type="button" onClick={() => zoom('out')} aria-label="Diminuir zoom" title="Diminuir zoom (−)">
          −
        </button>
        <button type="button" onClick={() => zoom('home')} title="Ver mapa inteiro (0)">
          Ver mapa inteiro
        </button>
      </div>
    </main>
  )
}
