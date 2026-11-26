import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Brush } from '../core/brush'
import { removeItem, type Sel } from '../core/items'
import type { World } from '../core/world'
import { createBrushOverlay } from '../render/brushOverlay'
import type { Renderer } from '../render/renderer'
import { centerOn, HOME, screenToWorld, transform, zoomAt, type View } from '../render/view'
import { placeItem } from './gestures/place'
import { startSelect } from './gestures/select'
import { startStroke } from './gestures/stroke'
import type { Gesture, GestureEnv } from './gestures/types'
import { toolDef, type Tool } from './tools'

/** The zoom steps shared by the +, −, 0 keys and the zoom buttons. */
export type ViewCommand = 'in' | 'out' | 'home'

/** A request to center the view on a map point; a new `n` triggers it even for the same point. */
export type Focus = { x: number; y: number; n: number }

export interface MapInteractionOptions {
  world: World
  tool: Tool
  brush: Brush
  onCommit(w: World, msg?: string): void
  selection: Sel | null
  onSelect(s: Sel | null): void
  focus: Focus | null
  /** Frame margin around the map, in map units (see view.framePad). */
  pad: number
}

const WHEEL_ZOOM = 0.0015 // zoom per wheel pixel
const LINE_PX = 33 // Firefox reports mouse wheel notches in lines (deltaMode 1)
const PAGE_PX = 400
const KEY_PAN = 60 // CSS px per arrow key press
const KEY_ZOOM = 1.25
// Arrow key -> pan direction (the map moves the opposite way to the view).
const KEY_PANS: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }

/**
 * Mouse/keyboard on the map: wheel zoom, pan (Space + drag, middle button, or the Navegar tool), and the active
 * tool's gesture (see gestures/ and tools.ts). Keys on the focused canvas: arrows pan, + / - zoom, 0 resets,
 * Esc cancels, Delete removes the selected marker/label.
 * View, gesture and cursor live in refs, so moving the mouse never re-renders React; the renderer repaints itself.
 */
export function useMapInteraction(canvasRef: RefObject<HTMLCanvasElement | null>, rendererRef: RefObject<Renderer | null>, opts: MapInteractionOptions) {
  const [brushOverlay] = useState(createBrushOverlay)
  const live = useRef(opts)
  live.current = opts
  const view = useRef<View>(HOME)

  // Both read only refs, so they are stable and the listener effect below can use them.
  const zoomBy = useCallback(
    (factor: number, px: number, py: number) => {
      const { world, pad } = live.current
      const r = canvasRef.current!.getBoundingClientRect()
      view.current = zoomAt(view.current, world.width, world.height, pad, r.width, r.height, px, py, factor)
    },
    [canvasRef],
  )
  /** Zooms about the canvas centre, or back to the whole map; the caller repaints. */
  const step = useCallback(
    (c: ViewCommand) => {
      if (c === 'home') {
        view.current = HOME
        return
      }
      const r = canvasRef.current!.getBoundingClientRect()
      zoomBy(c === 'in' ? KEY_ZOOM : 1 / KEY_ZOOM, r.width / 2, r.height / 2)
    },
    [canvasRef, zoomBy],
  )

  // A new map (generate/import) has a new points array; edits and undo keep it, so they keep the view.
  useEffect(() => {
    view.current = HOME
    rendererRef.current?.draw(view.current)
  }, [opts.world.points, rendererRef])

  useEffect(() => rendererRef.current?.addOverlay(brushOverlay.overlay), [rendererRef, brushOverlay])

  const { focus } = opts
  useEffect(() => {
    const canvas = canvasRef.current
    if (!focus || !canvas) return
    const { world, pad } = live.current
    view.current = centerOn(view.current, world.width, world.height, pad, canvas.clientWidth, canvas.clientHeight, focus.x, focus.y)
    rendererRef.current?.draw(view.current)
  }, [focus, canvasRef, rendererRef])

  useEffect(() => {
    const canvas = canvasRef.current!
    let space = false
    let pan: { x: number; y: number } | null = null
    let gesture: Gesture | null = null
    let button = -1 // the mouse button that started the current pan/gesture

    const redraw = () => rendererRef.current?.draw(view.current)
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect()
      return { px: e.clientX - r.left, py: e.clientY - r.top, w: r.width, h: r.height }
    }
    const toWorld = (e: PointerEvent) => {
      const { world, pad } = live.current
      const { px, py, w, h } = local(e)
      return screenToWorld(view.current, world.width, world.height, pad, w, h, px, py)
    }
    const env: GestureEnv = {
      world: () => live.current.world,
      brush: () => live.current.brush,
      renderer: () => rendererRef.current,
      commit: (w, msg) => live.current.onCommit(w, msg),
      select: (s) => live.current.onSelect(s),
      worldPerPx: () => {
        const { world, pad } = live.current
        return 1 / transform(view.current, world.width, world.height, pad, canvas.clientWidth, canvas.clientHeight).s
      },
    }

    /** Updates the brush circle and mouse cursor for the current state, then repaints. */
    const refresh = (e: PointerEvent | null) => {
      const def = toolDef(live.current.tool)
      const panning = pan !== null || space || def.kind === 'view'
      if (!e || panning || def.kind !== 'stroke') brushOverlay.setCursor(null)
      else {
        const [x, y] = toWorld(e)
        brushOverlay.setCursor({ x, y, r: live.current.brush.radius })
      }
      canvas.style.cursor = pan ? 'grabbing' : panning ? 'grab' : def.kind === 'select' ? 'default' : 'crosshair'
      redraw()
    }
    const endGesture = (commit: boolean) => {
      gesture?.end(commit)
      gesture = null
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1)
      const { px, py } = local(e)
      zoomBy(Math.exp(-dy * WHEEL_ZOOM), px, py)
      redraw()
    }

    const onDown = (e: PointerEvent) => {
      if (button !== -1) return // a gesture is already running
      // preventDefault below also cancels the browser's focus-on-click, so focus explicitly: map keys need it.
      canvas.focus({ preventScroll: true })
      const def = toolDef(live.current.tool)
      if (e.button === 1 || (e.button === 0 && (space || def.kind === 'view'))) {
        e.preventDefault() // no middle-button autoscroll
        pan = { x: e.clientX, y: e.clientY }
      } else if (e.button === 0) {
        const [x, y] = toWorld(e)
        if (def.kind === 'stroke') gesture = startStroke(env, def.brush, x, y)
        else if (def.kind === 'select') gesture = startSelect(env, x, y)
        // A click on the frame margin or beside the sheet must not create an item off the map.
        else if (def.kind === 'place' && x >= 0 && y >= 0 && x <= live.current.world.width && y <= live.current.world.height)
          placeItem(env, def.place, x, y)
        if (!gesture) return refresh(e) // a click with nothing to drag
      } else return
      button = e.button
      canvas.setPointerCapture(e.pointerId)
      refresh(e)
    }

    const onMove = (e: PointerEvent) => {
      if (pan) {
        view.current = { ...view.current, x: view.current.x + e.clientX - pan.x, y: view.current.y + e.clientY - pan.y }
        pan = { x: e.clientX, y: e.clientY }
      } else if (gesture) gesture.move(...toWorld(e))
      refresh(e)
    }

    const onUp = (e: PointerEvent) => {
      if (e.type === 'pointerup' && e.button !== button) return // another button released mid-gesture
      button = -1
      pan = null
      endGesture(e.type === 'pointerup')
      refresh(e)
    }

    // Space-pan only when the map or the page itself has focus, so Space still presses a focused button.
    const spaceTarget = (t: EventTarget | null) => t === document.body || t === canvas
    const onSpace = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceTarget(e.target)) return
      e.preventDefault() // don't scroll the page
      space = e.type === 'keydown'
      refresh(null)
    }
    const onBlur = () => {
      space = false // keyup is lost if the window loses focus mid-press
      refresh(null)
    }

    // Keys on the focused canvas: the keyboard path for navigating the map.
    const onCanvasKey = (e: KeyboardEvent) => {
      const { selection, world } = live.current
      if (KEY_PANS[e.key]) {
        const [dx, dy] = KEY_PANS[e.key]
        view.current = { ...view.current, x: view.current.x + dx * KEY_PAN, y: view.current.y + dy * KEY_PAN }
      } else if (e.key === '+' || e.key === '=') step('in')
      else if (e.key === '-') step('out')
      else if (e.key === '0') step('home')
      else if (e.key === 'Escape') endGesture(false)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection && selection.type !== 'state') {
        live.current.onCommit(removeItem(world, selection), 'Removido.')
        live.current.onSelect(null)
      } else return
      e.preventDefault()
      redraw()
    }

    const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
      [canvas, 'wheel', onWheel as EventListener, { passive: false }], // React's onWheel is passive
      [canvas, 'pointerdown', onDown as EventListener],
      [canvas, 'pointermove', onMove as EventListener],
      [canvas, 'pointerup', onUp as EventListener],
      [canvas, 'pointercancel', onUp as EventListener],
      [canvas, 'pointerleave', () => refresh(null)],
      [canvas, 'keydown', onCanvasKey as EventListener],
      [window, 'keydown', onSpace as EventListener],
      [window, 'keyup', onSpace as EventListener],
      [window, 'blur', onBlur],
    ]
    for (const [t, type, fn, o] of listeners) t.addEventListener(type, fn, o)
    return () => {
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn)
      endGesture(false)
    }
  }, [canvasRef, rendererRef, brushOverlay, zoomBy, step])

  /** For the on-map zoom buttons: the same steps as the keys, then a repaint. */
  return {
    zoom: (c: ViewCommand) => {
      step(c)
      rendererRef.current?.draw(view.current)
    },
  }
}
