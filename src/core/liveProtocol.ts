// Shared types and pure helpers for live synchronization between the MCP server and the browser editor.
// Runs in both Node and browser with zero platform-specific imports.
import type { River, State, World } from './world'

export type LiveHighlight =
  | { kind: 'point'; x: number; y: number; label?: string }
  | { kind: 'stroke'; points: { x: number; y: number }[]; radius: number; label?: string }
  | { kind: 'area'; x: number; y: number; radius: number; label?: string }

export interface LiveWorldEvent {
  rev: number
  source: 'mcp' | 'browser'
  clientId?: string
  reason: string
  replaced: boolean
  worldJson: string | null
  highlight?: LiveHighlight
  highlights?: LiveHighlight[]
}

export interface LivePushRequest {
  worldJson: string
  baseRev?: number
  clientId?: string
  reason?: string
}

export interface LivePushResponse {
  ok: boolean
  rev: number
  conflict: boolean
  error?: string
}

export interface LiveHealthResponse {
  ok: boolean
  rev: number
  hasWorld: boolean
  clients: number
}

function typedEqual(a: Float32Array | Uint8Array | Uint16Array, b: Float32Array | Uint8Array | Uint16Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function numArrayEqual(a: number[], b: number[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function riversEqual(a: River[], b: River[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!numArrayEqual(a[i].cells, b[i].cells) || !numArrayEqual(a[i].flow, b[i].flow)) return false
  }
  return true
}

function statesEqual(a: State[], b: State[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.name !== y.name || x.color !== y.color || x.capital !== y.capital || x.auto !== y.auto) return false
  }
  return true
}

/**
 * Reuses identical typed-array, river, and state references from `prev` when deserializing an updated World.
 * This prevents unnecessary Delaunay mesh rebuilds, offscreen canvas redraws, and camera resets on incremental syncs.
 */
export function reuseUnchangedWorldData(prev: World | null, next: World): World {
  if (!prev) return next
  const sameSize = prev.width === next.width && prev.height === next.height
  const points = sameSize && typedEqual(prev.points, next.points) ? prev.points : next.points
  const elevation = points === prev.points && typedEqual(prev.elevation, next.elevation) ? prev.elevation : next.elevation
  const biome = points === prev.points && typedEqual(prev.biome, next.biome) ? prev.biome : next.biome
  const biomeOverride = points === prev.points && typedEqual(prev.biomeOverride, next.biomeOverride) ? prev.biomeOverride : next.biomeOverride
  const stateId = points === prev.points && typedEqual(prev.stateId, next.stateId) ? prev.stateId : next.stateId
  const rivers = points === prev.points && riversEqual(prev.rivers, next.rivers) ? prev.rivers : next.rivers
  const states = statesEqual(prev.states, next.states) ? prev.states : next.states
  if (
    points === next.points &&
    elevation === next.elevation &&
    biome === next.biome &&
    biomeOverride === next.biomeOverride &&
    stateId === next.stateId &&
    rivers === next.rivers &&
    states === next.states
  ) {
    return next
  }
  return { ...next, points, elevation, biome, biomeOverride, stateId, rivers, states }
}

/** Focal point of a visual highlight, used for optional camera centering. */
export function highlightCenter(h: LiveHighlight): { x: number; y: number } {
  if (h.kind === 'stroke') {
    if (!h.points.length) return { x: 0, y: 0 }
    let sx = 0
    let sy = 0
    for (const p of h.points) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / h.points.length, y: sy / h.points.length }
  }
  return { x: h.x, y: h.y }
}

const REASON_LABELS: Record<string, string> = {
  generate_world: 'IA gerou um novo mapa.',
  load_world: 'IA carregou um mapa.',
  brush_stroke: 'IA esculpiu o mapa com pincel.',
  regenerate_kingdoms: 'IA regerou os reinos.',
  manage_markers: 'IA atualizou marcadores.',
  manage_labels: 'IA atualizou rótulos.',
  manage_kingdoms: 'IA atualizou reinos.',
  update_settings: 'IA alterou configurações do mapa.',
  undo: 'IA desfez a última alteração.',
  redo: 'IA refez a alteração.',
  browser_edit: 'Mapa sincronizado com outra aba.',
}

export function describeLiveReason(reason: string, highlight?: LiveHighlight): string {
  const base = REASON_LABELS[reason] ?? 'Mapa atualizado via MCP.'
  return highlight?.label ? `${base.replace(/\.$/, '')}: ${highlight.label}.` : base
}
