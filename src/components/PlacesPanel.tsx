import { useRef, useState, type ReactNode } from 'react'
import { markerKindName, sameSel, selKey, type Patch, type Sel } from '../core/items'
import { TEXT_LIMITS, type World } from '../core/world'
import { DraftInput } from './DraftInput'
import { IconPicker } from './IconPicker'

interface Props {
  world: World
  selection: Sel | null
  onSelect(s: Sel, center: boolean): void
  onPatch(s: Sel, p: Patch): void
  onDelete(s: Sel): void
  onAddState(): void
}

/** Case- and accent-insensitive "contains". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
/** Editor input guards: ignore empty names/texts and non-numbers. */
const nonEmpty = (f: (v: string) => void) => (v: string) => v.trim() && f(v.trim())

/** "Lugares": kingdoms, markers and labels with search, plus an editor for the selected one. */
export function PlacesPanel({ world, selection, onSelect, onPatch, onDelete, onAddState }: Props) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // Deleting unmounts the focused button: send focus somewhere stable so keyboard users keep their place.
  const deleteAndRefocus = (s: Sel) => {
    onDelete(s)
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  const q = norm(query.trim())
  const match = (...texts: string[]) => !q || texts.some((t) => norm(t).includes(q))
  const states = world.states.filter((s) => match(s.name))
  const markers = world.markers.filter((m) => match(m.name, m.notes, markerKindName(world, m)))
  const labels = world.labels.filter((l) => match(l.text))
  const row = (sel: Sel, text: string, extra?: ReactNode) => (
    <li key={selKey(sel)}>
      <button type="button" className="place-row" aria-pressed={sameSel(selection, sel)} onClick={() => onSelect(sel, true)}>
        {extra}
        {text || '(sem nome)'}
      </button>
    </li>
  )

  return (
    <div className="places">
      <input ref={searchRef} type="search" placeholder="Buscar…" aria-label="Buscar lugares" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="row">
        <h3>Reinos</h3>
        <button type="button" onClick={onAddState} title="Cria um reino vazio para pintar com o pincel de reino">
          + Novo reino
        </button>
      </div>
      <ul>{states.map((s) => row({ type: 'state', id: s.id }, s.name, <span className="swatch" style={{ background: s.color }} aria-hidden="true" />))}</ul>
      <h3>Marcadores</h3>
      <ul>{markers.map((m) => row({ type: 'marker', id: m.id }, m.name, <span className="kind">{markerKindName(world, m)}</span>))}</ul>
      <h3>Rótulos</h3>
      <ul>{labels.map((l) => row({ type: 'label', id: l.id }, l.text))}</ul>
      {!states.length && !markers.length && !labels.length && <p className="hint">Nada encontrado.</p>}

      {selection && <Editor key={selKey(selection)} world={world} sel={selection} onPatch={onPatch} onDelete={deleteAndRefocus} />}
    </div>
  )
}

function Editor({ world, sel, onPatch, onDelete }: { world: World; sel: Sel; onPatch: Props['onPatch']; onDelete: Props['onDelete'] }) {
  const patch = (p: Patch) => onPatch(sel, p)

  if (sel.type === 'state') {
    const s = world.states.find((x) => x.id === sel.id)
    if (!s) return null
    return (
      <div className="editor" role="group" aria-label="Editar reino">
        <DraftInput label="Nome do reino" value={s.name} maxLength={TEXT_LIMITS.name} onCommit={nonEmpty((name) => patch({ name }))} />
        <DraftInput label="Cor" type="color" value={s.color} onCommit={(color) => patch({ color })} />
        <p className="hint">Pinte as terras do reino com a ferramenta “Pintar reino”.</p>
      </div>
    )
  }
  if (sel.type === 'marker') {
    const m = world.markers.find((x) => x.id === sel.id)
    if (!m) return null
    return (
      <div className="editor" role="group" aria-label="Editar marcador">
        <DraftInput label="Nome" value={m.name} maxLength={TEXT_LIMITS.name} onCommit={(name) => patch({ name })} />
        <details className="kind-picker">
          <summary>Tipo: {markerKindName(world, m)}</summary>
          <IconPicker label="Tipo do marcador" kind={m.kind} icon={m.icon} icons={world.icons} onChange={(kind, icon) => patch({ kind, icon: icon ?? 0 })} />
        </details>
        <DraftInput label="Notas" multiline value={m.notes} maxLength={TEXT_LIMITS.notes} onCommit={(notes) => patch({ notes })} />
        <button type="button" onClick={() => onDelete(sel)}>
          Excluir marcador
        </button>
      </div>
    )
  }
  const l = world.labels.find((x) => x.id === sel.id)
  if (!l) return null
  return (
    <div className="editor" role="group" aria-label="Editar rótulo">
      <DraftInput label="Texto" value={l.text} maxLength={TEXT_LIMITS.label} onCommit={nonEmpty((text) => patch({ text }))} />
      <div className="row">
        <DraftInput label="Tamanho" type="number" value={String(l.size)} onCommit={(v) => patch({ size: Number(v) })} />
        <DraftInput label="Rotação (°)" type="number" value={String(l.rotation)} onCommit={(v) => patch({ rotation: Number(v) })} />
      </div>
      <button type="button" onClick={() => onDelete(sel)}>
        Excluir rótulo
      </button>
    </div>
  )
}
