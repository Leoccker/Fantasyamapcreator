// Places on the map (kingdoms, markers, labels): pure edits that return a new World, plus hit-testing.
import { isWaterBiome, NO_BIOME } from './biomes'
import { clamp } from './math'
import { KINGDOM_COLORS, stateCenter } from './kingdoms'
import { iconDef, isIconSrc, ICON_LIMITS, type CustomIcon } from './icons'
import { getMesh } from './mesh'
import { makeNamer, type NameKind } from './names'
import { rngFor } from './rng'
import { POINT_DECIMALS, round, TEXT_LIMITS, type Label, type Marker, type MarkerKind, type State, type World } from './world'

export type Sel = { type: 'state' | 'marker' | 'label'; id: number }

/** Marker icon size in map units. */
export const MARKER_SIZE = 12
export const DEFAULT_LABEL_SIZE = 22

export const sameSel = (a: Sel | null | undefined, b: Sel) => a?.type === b.type && a.id === b.id
export const selKey = (s: Sel) => `${s.type}-${s.id}`

/** The item a selection points at, or undefined if it no longer exists (e.g. after undo). */
export function findItem(w: World, sel: Sel): State | Marker | Label | undefined {
  const list: (State | Marker | Label)[] = sel.type === 'marker' ? w.markers : sel.type === 'label' ? w.labels : w.states
  return list.find((it) => it.id === sel.id)
}

export const itemExists = (w: World, sel: Sel | null): sel is Sel => sel !== null && findItem(w, sel) !== undefined

/** Where to look for an item: a marker/label's position, a kingdom's capital or middle. */
export function itemCenter(w: World, sel: Sel): { x: number; y: number } | null {
  if (sel.type === 'state') {
    const c = stateCenter(w, sel.id)
    return c && { x: c[0], y: c[1] }
  }
  const it = findItem(w, sel) as Marker | Label | undefined
  return it ? { x: it.x, y: it.y } : null
}

/** Copy without the `auto` flag: a hand-edited item is no longer "generated". */
export function withoutAuto<T extends { auto?: true }>(x: T): T {
  const copy = { ...x }
  delete copy.auto
  return copy
}

const wrapDegrees = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const takenNames = (w: World) => [...w.states.map((s) => s.name), ...w.markers.map((m) => m.name), ...w.labels.map((l) => l.text)]
/** A fresh name for new item `id`, seeded by the map and the id, unique on this map. */
const nameFor = (w: World, id: string | number, kind: NameKind) => makeNamer(rngFor(w.seed, `name:${id}`), takenNames(w))(kind)
const onMap = (w: World, x: number, y: number) => ({
  x: round(clamp(x, 0, w.width), POINT_DECIMALS),
  y: round(clamp(y, 0, w.height), POINT_DECIMALS),
})

/** A new marker of `kind`, or drawn with uploaded icon `iconId` (ignored if that icon is gone). */
export function addMarker(w: World, kind: MarkerKind, x: number, y: number, iconId?: number): [World, Sel] {
  const id = w.nextId
  const custom = w.icons.find((i) => i.id === iconId)
  const name = custom ? custom.name : iconDef(kind).named ? nameFor(w, id, 'city') : iconDef(kind).name
  const m: Marker = { id, kind, ...onMap(w, x, y), name, notes: '', ...(custom && { icon: custom.id }) }
  return [{ ...w, markers: [...w.markers, m], nextId: id + 1 }, { type: 'marker', id }]
}

/** What a marker is, for lists and search: its uploaded icon's name, or its kind's. */
export const markerKindName = (w: World, m: Marker) => (m.icon && w.icons.find((i) => i.id === m.icon)?.name) || iconDef(m.kind).name

/** Adds an uploaded icon. Null when the map is full or the image breaks the file rules (it could not be saved). */
export function addIcon(w: World, name: string, src: string): [World, number] | null {
  if (w.icons.length >= ICON_LIMITS.count || !isIconSrc(src)) return null
  // Its own id series: reusing a deleted icon's id is harmless, since undo restores whole Worlds.
  const id = Math.max(0, ...w.icons.map((i) => i.id)) + 1
  const icon: CustomIcon = { id, name: name.trim().slice(0, TEXT_LIMITS.name) || 'Ícone', src }
  return [{ ...w, icons: [...w.icons, icon] }, id]
}

/** Removes an uploaded icon; its markers go back to their kind's icon. One undo step. */
export function removeIcon(w: World, id: number): World {
  if (!w.icons.some((i) => i.id === id)) return w
  const markers = w.markers.map((m) => (m.icon === id ? withoutIcon(m) : m))
  return { ...w, icons: w.icons.filter((i) => i.id !== id), markers }
}

function withoutIcon(m: Marker): Marker {
  const copy = { ...m }
  delete copy.icon
  return copy
}

export function addLabel(w: World, x: number, y: number): [World, Sel] {
  const id = w.nextId
  const onWater = isWaterBiome(w.biome[getMesh(w).delaunay.find(x, y)])
  const l: Label = { id, text: onWater ? nameFor(w, id, 'sea') : 'Novo rótulo', ...onMap(w, x, y), size: DEFAULT_LABEL_SIZE, rotation: 0 }
  return [{ ...w, labels: [...w.labels, l], nextId: id + 1 }, { type: 'label', id }]
}

/** A new, empty kingdom to paint with the kingdom brush. */
export function addState(w: World): [World, Sel] {
  const id = Math.max(0, ...w.states.map((s) => s.id)) + 1
  const used = new Set(w.states.map((s) => s.color))
  const color = KINGDOM_COLORS.find((c) => !used.has(c)) ?? KINGDOM_COLORS[id % KINGDOM_COLORS.length]
  const s: State = { id, name: nameFor(w, `state:${id}`, 'state'), color, capital: null }
  return [{ ...w, states: [...w.states, s] }, { type: 'state', id }]
}

/** For markers, `icon: 0` means "back to the kind's own icon". */
export type Patch = Partial<
  Pick<Marker, 'name' | 'notes' | 'kind' | 'x' | 'y'> & { icon: number } & Pick<Label, 'text' | 'size' | 'rotation'> & Pick<State, 'color' | 'capital'>
>

/** Clamps/rounds positions, sizes and angles and caps text lengths. */
function normalize(w: World, p: Patch): Patch {
  const n: Patch = { ...p }
  if (p.x !== undefined) n.x = onMap(w, p.x, 0).x
  if (p.y !== undefined) n.y = onMap(w, 0, p.y).y
  if (p.size !== undefined) n.size = Math.round(clamp(p.size, ...TEXT_LIMITS.labelSize))
  if (p.rotation !== undefined) n.rotation = Math.round(wrapDegrees(p.rotation))
  if (p.name !== undefined) n.name = p.name.slice(0, TEXT_LIMITS.name)
  if (p.notes !== undefined) n.notes = p.notes.slice(0, TEXT_LIMITS.notes)
  if (p.text !== undefined) n.text = p.text.slice(0, TEXT_LIMITS.label)
  return n
}

/** Applies `fields` of the patch to item `id`; the same array back when nothing changes. */
function update<T extends { id: number; auto?: true }>(items: T[], id: number, p: Patch, fields: (keyof Patch & keyof T)[]): T[] {
  const old = items.find((it) => it.id === id)
  const changed = old && fields.filter((f) => p[f] !== undefined && p[f] !== old[f])
  if (!old || !changed?.length) return items
  const next = withoutAuto({ ...old, ...Object.fromEntries(changed.map((f) => [f, p[f]])) })
  return items.map((it) => (it === old ? next : it))
}

/**
 * Applies a patch to one item (normalized, `auto` removed). Returns the same World when nothing changes,
 * so a blur without an edit adds no history step.
 */
export function patchItem(w: World, sel: Sel, patch: Patch): World {
  const p = normalize(w, patch)
  if (sel.type === 'marker') {
    const old = w.markers.find((m) => m.id === sel.id)
    if (p.icon !== undefined && p.icon !== 0 && !w.icons.some((i) => i.id === p.icon)) delete p.icon
    if (p.icon === 0 && old?.icon === undefined) delete p.icon // already on its kind's icon: no edit
    const markers = update(w.markers, sel.id, p, ['name', 'notes', 'kind', 'x', 'y', 'icon'])
    if (markers === w.markers) return w
    // icon 0 is stored as no icon at all, so save -> load stays exact.
    return { ...w, markers: markers.map((m) => (m.icon === 0 ? withoutIcon(m) : m)) }
  }
  if (sel.type === 'label') {
    const labels = update(w.labels, sel.id, p, ['text', 'size', 'rotation', 'x', 'y'])
    return labels === w.labels ? w : { ...w, labels }
  }
  if (p.capital !== undefined && p.capital !== null && !w.markers.some((m) => m.id === p.capital)) delete p.capital
  const states = update(w.states, sel.id, p, ['name', 'color', 'capital'])
  return states === w.states ? w : { ...w, states }
}

export const moveItem = (w: World, sel: Sel, x: number, y: number) => patchItem(w, sel, { x, y })

/** Removes a marker or label (kingdoms are never deleted, so their ids stay stable). */
export function removeItem(w: World, sel: Sel): World {
  if (sel.type === 'state' || !findItem(w, sel)) return w
  if (sel.type === 'label') return { ...w, labels: w.labels.filter((l) => l.id !== sel.id) }
  const states = w.states.map((s) => (s.capital === sel.id ? { ...s, capital: null } : s))
  return { ...w, markers: w.markers.filter((m) => m.id !== sel.id), states }
}

/**
 * What is under (x, y): markers first (top-most), then labels (rotated box; width estimated from the text,
 * no canvas needed), then the kingdom of the cell. `slop` widens the hit area, in map units.
 */
export function hitTest(w: World, x: number, y: number, slop: number): Sel | null {
  for (let k = w.markers.length - 1; k >= 0; k--) {
    const m = w.markers[k]
    if (Math.hypot(m.x - x, m.y - y) <= MARKER_SIZE * 0.7 + slop) return { type: 'marker', id: m.id }
  }
  for (let k = w.labels.length - 1; k >= 0; k--) {
    const l = w.labels[k]
    const a = (-l.rotation * Math.PI) / 180
    const dx = x - l.x
    const dy = y - l.y
    const lx = dx * Math.cos(a) - dy * Math.sin(a)
    const ly = dx * Math.sin(a) + dy * Math.cos(a)
    if (Math.abs(lx) <= (l.text.length * l.size * 0.5) / 2 + slop && Math.abs(ly) <= l.size / 2 + slop) return { type: 'label', id: l.id }
  }
  const s = w.stateId[getMesh(w).delaunay.find(x, y)]
  return s && w.states.some((st) => st.id === s) ? { type: 'state', id: s } : null
}

/** True when the map holds hand-made content that regenerating would lose. */
export function hasHandEdits(w: World): boolean {
  return (
    w.biomeOverride.some((b) => b !== NO_BIOME) ||
    w.states.some((s) => !s.auto) ||
    w.markers.some((m) => !m.auto) ||
    w.labels.some((l) => !l.auto)
  )
}
