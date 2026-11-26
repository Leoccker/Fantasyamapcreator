import { useEffect, useRef, useState } from 'react'
import { Biome } from '../core/biomes'
import type { Brush } from '../core/brush'
import { DEFAULTS, generate, type GenInput } from '../core/generate'
import { createHistory } from '../core/history'
import { generateFromMask } from '../core/importMask'
import { addIcon, addState, findItem, hasHandEdits, itemCenter, itemExists, patchItem, removeIcon, removeItem, type Sel } from '../core/items'
import { generateKingdoms } from '../core/kingdoms'
import { patchSettings } from '../core/settings'
import { LIMITS, parseWorld, serializeWorld, type GenParams, type World } from '../core/world'
import { DEFAULT_LAYERS, type Layers } from '../render/draw'
import { renderPng } from '../render/renderer'
import { BiomeLegend } from './BiomeLegend'
import { ConfirmDiscard } from './ConfirmDiscard'
import { GeneratorPanel, type GenForm } from './GeneratorPanel'
import { LayerToggles } from './LayerToggles'
import { MapSettingsPanel } from './MapSettingsPanel'
import { MapCanvas } from './MapCanvas'
import { PlacesPanel } from './PlacesPanel'
import { Section } from './Section'
import type { Status } from './StatusMessage'
import { ToolPanel } from './ToolPanel'
import { TopBar } from './TopBar'
import { isTyping } from './dom'
import { fileToIconSrc, iconName } from './iconUpload'
import { svgToLandMask } from './svgRaster'
import { bootFromAutosave, browserStorage, useAutosave } from './useAutosave'
import type { Tool } from './tools'
import type { Focus } from './useMapInteraction'

const PARAM_KEYS = Object.keys(LIMITS) as (keyof typeof LIMITS)[]

const toForm = (seed: string, p: GenParams): GenForm => ({
  seed,
  continents: String(p.continents),
  waterPct: String(p.waterPct),
  cellCount: String(p.cellCount),
  kingdoms: String(p.kingdoms),
  biomes: p.biomes,
})

function fromForm(f: GenForm): Required<GenInput> {
  const input = { ...DEFAULTS, seed: f.seed.trim() || DEFAULTS.seed, biomes: f.biomes }
  for (const k of PARAM_KEYS) {
    const n = f[k].trim() === '' ? NaN : Math.round(Number(f[k]))
    const [min, max] = LIMITS[k]
    input[k] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULTS[k]
  }
  return input
}

/** Makes a map and says how long it took ("<what> em N ms · ..."), the same way for generate and import. */
function timed(what: string, make: () => World): [World, Status] {
  const t = performance.now()
  const w = make()
  const ms = Math.round(performance.now() - t)
  return [w, { text: `${what} em ${ms} ms · ${w.points.length / 2} células · ${w.rivers.length} rios`, error: false }]
}

const timedGenerate = (input: GenInput) => timed('Gerado', () => generate(input))

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const fileBase = (w: World) => `mapa-${w.seed.replace(/[^\w-]/g, '_') || 'sem-nome'}`

export function App() {
  const [storage] = useState(browserStorage)
  const [initial] = useState(() => bootFromAutosave(storage, () => timedGenerate(DEFAULTS)))
  const [world, setWorldState] = useState<World>(initial.world)
  // The latest World, also between a setWorld and the next render: async work (icon upload) must build on it.
  const worldRef = useRef(world)
  const setWorld = (w: World) => {
    worldRef.current = w
    setWorldState(w)
  }
  const [status, setStatus] = useState<Status>(initial.status)
  const [form, setForm] = useState<GenForm>(() => toForm(initial.world.seed, initial.world.params))
  // Hand edits since this map was made, including sculpting (which hasHandEdits can't see). Saved with the
  // autosave, so a restored map still asks before being discarded.
  const edited = useRef(initial.edited)
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS)
  const [tool, setTool] = useState<Tool>('navigate')
  const [brush, setBrush] = useState<Brush>({ radius: 40, strength: 0.5, biome: Biome.Forest, state: 0, marker: 'city' })
  // Undo can remove the selected item, so the selection is checked against the current world on every render.
  const [rawSelection, setSelection] = useState<Sel | null>(null)
  const selection = itemExists(world, rawSelection) ? rawSelection : null
  const [focus, setFocus] = useState<Focus | null>(null)
  const kingdomVariant = useRef(0) // each "Gerar reinos" click gives a new layout
  // Snapshots are World references (edits never mutate a World), so history costs no copies.
  // Every history change goes with a setWorld, which re-renders the undo/redo buttons.
  const [history] = useState(() => createHistory<World>())
  // An action (generate/import) waiting for the user to confirm discarding hand edits.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)

  const say = (text: string, error = false) => setStatus({ text, error })
  const autosave = useAutosave(storage, world, edited, initial.canSave)

  /** Replaces the map with a new one (generate/import): history belongs to the old map. */
  function show(w: World) {
    history.clear()
    edited.current = false
    setSelection(null)
    setWorld(w)
    setForm(toForm(w.seed, w.params))
  }

  /**
   * Runs `action` now, or first asks (in a strip under the top bar) when it would throw away hand edits, including imported ones.
   * Display settings don't count: a new map keeps them.
   */
  function unlessEdited(action: () => void) {
    if (edited.current || hasHandEdits(world)) setPendingDiscard(() => action)
    else action()
  }

  /**
   * One undo step. An edit that changed nothing (same World back) is ignored. `handEdit` false is for display
   * settings, which regenerating keeps anyway, so they don't make "Gerar" ask before discarding.
   */
  function commit(w: World, msg = 'Mapa editado.', handEdit = true) {
    if (w === worldRef.current) return
    if (handEdit) edited.current = true
    history.push(worldRef.current)
    setWorld(w)
    say(msg)
  }

  /** New kingdoms (and their generated places) on the current terrain; hand-made places are kept. Undoable. */
  function regenerateKingdoms() {
    const count = fromForm(form).kingdoms
    commit(generateKingdoms(world, count, ++kingdomVariant.current), count ? 'Reinos gerados.' : 'Reinos removidos.')
    setSelection(null)
  }

  function chooseTool(t: Tool) {
    setTool(t)
    // The kingdom brush needs a kingdom to paint; default to the first one.
    if (t === 'kingdom' && !world.states.some((s) => s.id === brush.state)) setBrush({ ...brush, state: world.states[0]?.id ?? 0 })
  }

  /** Selects a place: announced for screen readers, and the Lugares section opens to show its editor. */
  function select(s: Sel | null, center = false) {
    setSelection(s)
    if (!s) return
    const it = findItem(world, s)
    if (it) say(`Selecionado: ${'text' in it ? it.text : it.name}`)
    const at = center && itemCenter(world, s)
    if (at) setFocus((f) => ({ ...at, n: (f?.n ?? 0) + 1 }))
  }

  // After "Gerar reinos" or undo the brush's kingdom may be gone: paint the first one instead. Likewise an
  // uploaded icon removed by undo or import: back to the kind's own icon.
  let liveBrush = brush.state === 0 || world.states.some((s) => s.id === brush.state) ? brush : { ...brush, state: world.states[0]?.id ?? 0 }
  if (liveBrush.icon !== undefined && !world.icons.some((i) => i.id === liveBrush.icon)) liveBrush = { ...liveBrush, icon: undefined }

  function undo() {
    const w = history.undo(world)
    if (!w) return
    setWorld(w)
    say('Desfeito.')
  }

  function redo() {
    const w = history.redo(world)
    if (!w) return
    setWorld(w)
    say('Refeito.')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) undo()
      else if ((k === 'z' && e.shiftKey) || k === 'y') redo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function regenerate(f: GenForm) {
    unlessEdited(() => {
      const [w, s] = timedGenerate(fromForm(f))
      show({ ...w, settings: world.settings, icons: world.icons }) // a new map keeps your settings and uploaded icons
      setStatus(s)
    })
  }

  async function exportPng() {
    try {
      download(await renderPng(world, 2, layers), `${fileBase(world)}.png`)
      say('PNG exportado.')
    } catch (err) {
      say((err as Error).message, true)
    }
  }

  async function exportSvg() {
    try {
      const { renderSvg } = await import('../render/svg') // carries the font files: loaded only when asked
      download(await renderSvg(world, layers), `${fileBase(world)}.svg`)
      say('SVG exportado.')
    } catch (err) {
      say((err as Error).message, true)
    }
  }

  async function uploadIcon(file: File) {
    try {
      const src = await fileToIconSrc(file)
      const added = addIcon(worldRef.current, iconName(file), src) // edits made while decoding are kept
      if (!added) throw new Error('O mapa já tem o máximo de ícones, ou a imagem ficou grande demais.')
      commit(added[0], 'Ícone enviado.')
      setBrush((b) => ({ ...b, icon: added[1] }))
    } catch (err) {
      say(`Não foi possível enviar o ícone: ${(err as Error).message}`, true)
    }
  }

  function deleteIcon(id: number) {
    const uses = world.markers.filter((m) => m.icon === id).length
    commit(removeIcon(world, id), `Ícone excluído${uses ? `; ${uses} marcador(es) voltaram ao ícone do tipo` : ''}. Ctrl+Z desfaz.`)
    setBrush((b) => ({ ...b, icon: undefined }))
  }

  /** "Importar mapa": a saved JSON, or an SVG drawing used as the land outline. */
  function importMap(file: File) {
    return /\.svg$/i.test(file.name) || file.type === 'image/svg+xml' ? importSvg(file) : importJson(file)
  }

  /** A new map on the drawing's outline, with the form's seed, cells and kingdoms; settings and icons stay. */
  async function importSvg(file: File) {
    try {
      const mask = await svgToLandMask(file)
      const [w, s] = timed(`${file.name} importado`, () => generateFromMask(fromForm(form), mask)) // throws before touching the current map
      unlessEdited(() => {
        const { settings, icons } = worldRef.current // the map may have changed while the file was read
        show({ ...w, settings, icons })
        setStatus(s)
      })
    } catch (err) {
      say(`Não foi possível importar o SVG: ${(err as Error).message}`, true)
    }
  }

  async function importJson(file: File) {
    try {
      const w = parseWorld(await file.text()) // throws before touching the current map
      unlessEdited(() => {
        show(w)
        say(`Importado: ${file.name}`)
      })
    } catch (err) {
      say(`Não foi possível importar: ${(err as Error).message}`, true)
    }
  }

  return (
    <>
      <div className="top">
        <TopBar
          onExportPng={exportPng}
          onExportSvg={exportSvg}
          onExportJson={() => {
            download(new Blob([serializeWorld(world)], { type: 'application/json' }), `${fileBase(world)}.json`)
            say('JSON exportado.')
          }}
          onImport={importMap}
          autosave={{ available: !!storage, failing: autosave.failing, backup: autosave.backup }}
          onClearSaved={() => {
            autosave.clear()
            say(storage ? 'Dados salvos neste navegador apagados. O mapa volta a ser salvo na próxima edição.' : 'Este navegador não permite salvar dados locais.')
          }}
          canUndo={history.canUndo()}
          canRedo={history.canRedo()}
          onUndo={undo}
          onRedo={redo}
          status={status}
        />
        {pendingDiscard && (
          <ConfirmDiscard
            onConfirm={() => {
              setPendingDiscard(null)
              pendingDiscard()
            }}
            onCancel={() => setPendingDiscard(null)}
          />
        )}
      </div>
      <aside className="panel">
        <Section id="generator" title="Gerador" defaultOpen>
          <GeneratorPanel
            form={form}
            onChange={setForm}
            onGenerate={() => regenerate(form)}
            // only Math.random in the app; it stays outside generate()
            onRandomSeed={() => regenerate({ ...form, seed: Math.random().toString(36).slice(2, 8) })}
            onGenerateKingdoms={regenerateKingdoms}
          />
        </Section>
        <Section id="tools" title="Ferramentas" defaultOpen>
          <ToolPanel
            tool={tool}
            onTool={chooseTool}
            brush={liveBrush}
            onBrush={setBrush}
            states={world.states}
            icons={world.icons}
            onUploadIcon={uploadIcon}
            onDeleteIcon={deleteIcon}
          />
        </Section>
        <Section id="places" title="Lugares" openWhen={selection}>
          <PlacesPanel
            world={world}
            selection={selection}
            onSelect={select}
            onPatch={(s, p) => commit(patchItem(world, s, p))}
            onDelete={(s) => {
              commit(removeItem(world, s), 'Removido.')
              setSelection(null)
            }}
            onAddState={() => {
              const [w, s] = addState(world)
              commit(w, 'Reino criado.')
              setSelection(s)
              setBrush({ ...brush, state: s.id })
            }}
          />
        </Section>
        <Section id="layers" title="Camadas">
          <LayerToggles layers={layers} onChange={setLayers} />
        </Section>
        <Section id="map" title="Mapa">
          <MapSettingsPanel world={world} onPatch={(p) => commit(patchSettings(world, p), 'Configurações do mapa alteradas.', false)} />
        </Section>
        <Section id="biomes" title="Biomas">
          <BiomeLegend />
        </Section>
      </aside>
      <MapCanvas
        world={world}
        layers={layers}
        tool={tool}
        brush={liveBrush}
        onCommit={commit}
        selection={selection}
        onSelect={select}
        focus={focus}
      />
    </>
  )
}
