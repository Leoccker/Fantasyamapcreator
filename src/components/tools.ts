// The tool table: what each tool is, how the map reacts to it, and which options the panel shows for it.
import type { BrushTool } from '../core/brush'

export type Tool = 'navigate' | 'select' | BrushTool | 'marker' | 'label'

/** Options shown in the tool panel. */
export type Control = 'radius' | 'strength' | 'biome' | 'state' | 'marker'

export type ToolDef = { id: Tool; label: string; controls: Control[] } & (
  | { kind: 'view' } // drag pans
  | { kind: 'select' } // click selects, drag moves markers/labels
  | { kind: 'stroke'; brush: BrushTool } // painted strokes with a live preview
  | { kind: 'place'; place: 'marker' | 'label' } // a click adds an item
)

export const TOOLS: ToolDef[] = [
  { id: 'navigate', label: 'Navegar', kind: 'view', controls: [] },
  { id: 'select', label: 'Selecionar', kind: 'select', controls: [] },
  { id: 'raise', label: 'Elevar', kind: 'stroke', brush: 'raise', controls: ['radius', 'strength'] },
  { id: 'lower', label: 'Rebaixar', kind: 'stroke', brush: 'lower', controls: ['radius', 'strength'] },
  { id: 'smooth', label: 'Suavizar', kind: 'stroke', brush: 'smooth', controls: ['radius', 'strength'] },
  { id: 'biome', label: 'Pintar bioma', kind: 'stroke', brush: 'biome', controls: ['radius', 'biome'] },
  { id: 'kingdom', label: 'Pintar reino', kind: 'stroke', brush: 'kingdom', controls: ['radius', 'state'] },
  { id: 'marker', label: 'Marcador', kind: 'place', place: 'marker', controls: ['marker'] },
  { id: 'label', label: 'Rótulo', kind: 'place', place: 'label', controls: [] },
]

export const toolDef = (t: Tool): ToolDef => TOOLS.find((d) => d.id === t)!
