// Decoded uploaded icons. Images load asynchronously: until one is ready the marker shows its kind's icon,
// and listeners (the renderer) repaint once it arrives. Exports wait for all of them.
import type { World } from '../core/world'

// shortcut: never evicted; fine for a few dozen 64 px icons, add an LRU if icons ever get big or many.
const cache = new Map<string, HTMLImageElement>()
const listeners = new Set<() => void>()

function load(src: string): HTMLImageElement {
  let img = cache.get(src)
  if (!img) {
    img = new Image()
    img.onload = () => listeners.forEach((fn) => fn())
    img.src = src
    cache.set(src, img)
  }
  return img
}

/** The decoded image, or null while it loads (or if it is broken / running headless without DOM). */
export function iconImage(src: string | undefined): HTMLImageElement | null {
  if (!src || typeof Image === 'undefined') return null
  const img = load(src)
  return img.complete && img.naturalWidth ? img : null
}

/** Calls `fn` whenever an icon finishes loading. Returns the unsubscribe function. */
export function onIconLoad(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Resolves once every icon of the map is decoded (or has failed: those keep their kind's icon). */
export async function iconsReady(w: World): Promise<void> {
  await Promise.all(w.icons.map((i) => load(i.src).decode().catch(() => undefined)))
}
