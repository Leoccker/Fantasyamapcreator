// The map font is bundled (@fontsource, imported in main.tsx), but the browser only fetches a webfont when
// something asks for it, and canvas text silently falls back to Georgia if it isn't loaded yet.

export const MAP_FONT = '"IM Fell English", Georgia, serif'

// Accented letters live in another unicode-range file; ask for them too.
const SAMPLE = 'Reino áàâãçéêíóôõú ÁÉÍÓÚÇ'

let ready: Promise<void> | null = null

/** Resolves once the map font can be drawn on a canvas. Never rejects: on failure the fallback font is used. */
export function fontsReady(): Promise<void> {
  ready ??= Promise.all([
    document.fonts.load(`16px ${MAP_FONT}`, SAMPLE),
    document.fonts.load(`italic 16px ${MAP_FONT}`, SAMPLE),
  ]).then(
    () => undefined,
    () => undefined,
  )
  return ready
}
