import { BIOME_NAMES, LAND_BIOMES, type Biome } from '../core/biomes'
import type { Brush } from '../core/brush'
import { useRef } from 'react'
import { ICON_LIMITS, type CustomIcon } from '../core/icons'
import { RADIUS_MIN } from '../core/mapSize'
import type { State } from '../core/world'
import { IconPicker } from './IconPicker'
import { toolDef, TOOLS, type Tool } from './tools'

interface Props {
  tool: Tool
  onTool(t: Tool): void
  brush: Brush
  onBrush(b: Brush): void
  /** Largest brush radius for this map's size. */
  maxRadius: number
  states: State[]
  icons: CustomIcon[]
  onUploadIcon(file: File): void
  onDeleteIcon(id: number): void
}

export function ToolPanel({ tool, onTool, brush, onBrush, maxRadius, states, icons, onUploadIcon, onDeleteIcon }: Props) {
  const controls = toolDef(tool).controls
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLButtonElement>(null)
  const full = icons.length >= ICON_LIMITS.count
  const uploaded = icons.find((i) => i.id === brush.icon)
  return (
    <div className="tools">
      <div className="tool-buttons" role="group" aria-label="Ferramenta ativa">
        {TOOLS.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={tool === id} onClick={() => onTool(id)}>
            {label}
          </button>
        ))}
      </div>
      {controls.includes('radius') && (
        <label>
          <span>Raio: {brush.radius}</span>
          <input type="range" min={RADIUS_MIN} max={maxRadius} step={1} value={brush.radius} onChange={(e) => onBrush({ ...brush, radius: Number(e.target.value) })} />
        </label>
      )}
      {controls.includes('strength') && (
        <label>
          <span>Força: {Math.round(brush.strength * 100)}%</span>
          <input type="range" min={5} max={100} step={5} value={Math.round(brush.strength * 100)} onChange={(e) => onBrush({ ...brush, strength: Number(e.target.value) / 100 })} />
        </label>
      )}
      {controls.includes('biome') && (
        <label>
          Bioma
          <select value={brush.biome} onChange={(e) => onBrush({ ...brush, biome: Number(e.target.value) as Biome })}>
            {LAND_BIOMES.map((b) => (
              <option key={b} value={b}>
                {BIOME_NAMES[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      {controls.includes('state') && (
        <>
          <label>
            Reino
            <select value={brush.state} onChange={(e) => onBrush({ ...brush, state: Number(e.target.value) })}>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={0}>Apagar reino (sem dono)</option>
            </select>
          </label>
          <p className="hint">Botão direito ou Shift: tira células do reino (vão para o vizinho).</p>
        </>
      )}
      {controls.includes('marker') && (
        <>
          <IconPicker label="Ícone do marcador" kind={brush.marker} icon={brush.icon} icons={icons} onChange={(marker, icon) => onBrush({ ...brush, marker, icon })} />
          <div className="row">
            <button
              ref={uploadRef}
              type="button"
              disabled={full}
              title={full ? `Limite de ${ICON_LIMITS.count} ícones atingido: exclua um para enviar outro` : undefined}
              onClick={() => fileRef.current?.click()}
            >
              Enviar ícone…
            </button>
            {uploaded && (
              <button
                type="button"
                onClick={() => {
                  onDeleteIcon(uploaded.id)
                  uploadRef.current?.focus() // this button goes away; keep keyboard users nearby
                }}
                title={`Excluir “${uploaded.name}”; os marcadores com ele voltam ao ícone do tipo`}
              >
                Excluir ícone
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = '' // allow sending the same file again
              if (file) onUploadIcon(file)
            }}
          />
          <p className="hint">
            PNG, JPG, WebP ou GIF. A imagem é reduzida para 64 px e salva no mapa (até {ICON_LIMITS.count} ícones).
          </p>
        </>
      )}
    </div>
  )
}
