import { useEffect, useRef } from 'react'
import type { Layers } from '../render/draw'
import { createRenderer, type Renderer } from '../render/renderer'
import { framePad } from '../render/view'
import { useMapInteraction, type MapInteractionOptions } from './useMapInteraction'

type Props = Omit<MapInteractionOptions, 'pad'> & { layers: Layers }

/** Owns the imperative canvas renderer; React only tells it what to show. */
export function MapCanvas({ layers, ...interaction }: Props) {
  const { world, selection } = interaction
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)

  // Declared first so it runs before useMapInteraction's effects, which need the renderer.
  useEffect(() => {
    const r = createRenderer(canvasRef.current!, layers)
    rendererRef.current = r
    return () => {
      r.destroy()
      rendererRef.current = null
    }
    // Created once; world/layers are pushed by the effects below.
  }, [])

  useMapInteraction(canvasRef, rendererRef, { ...interaction, pad: framePad(world, layers.frame) })

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
    </main>
  )
}
