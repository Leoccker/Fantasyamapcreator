import { useRef } from 'react'
import type { SaveResult } from '../core/autosave'

interface Props {
  onExportPng(): void
  onExportSvg(): void
  onExportJson(): void
  onImport(file: File): void
  autosave: {
    /** Browser storage can be used at all. */
    available: boolean
    /** The last save failed (stays set until a save works again). */
    failing: SaveResult | null
    /** An unreadable older save is being kept aside. */
    backup: boolean
  }
  onClearSaved(): void
}

export function FileActions({ onExportPng, onExportSvg, onExportJson, onImport, autosave, onClearSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const failing = autosave.failing && !autosave.failing.ok ? autosave.failing : null
  return (
    <div className="actions">
      <button type="button" onClick={onExportPng}>
        Exportar PNG
      </button>
      <button type="button" onClick={onExportSvg} title="Desenho em vetor (linhas, ícones e textos editáveis) sobre o fundo pintado como imagem">
        Exportar SVG
      </button>
      <button type="button" onClick={onExportJson}>
        Exportar JSON
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} title="Um JSON salvo, ou um desenho SVG usado como contorno da terra">
        Importar mapa
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,.svg,image/svg+xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow re-importing the same file
          if (file) onImport(file)
        }}
      />

      {/* Visible text, not a tooltip: people should know their map and notes stay in this browser. */}
      {!autosave.available ? (
        <p className="hint">Este navegador não permite salvar dados locais: o mapa não é salvo sozinho. Exporte o JSON para guardar.</p>
      ) : (
        <>
          <p className="hint">
            O mapa, com suas notas, é salvo sozinho neste navegador.
            {autosave.backup && ' Há também uma cópia de um autosave antigo que não pôde ser aberto.'}
          </p>
          {failing && (
            <p className="hint error" role="alert">
              {failing.reason === 'quota' ? 'O autosave parou: o armazenamento está cheio.' : 'O autosave está falhando.'} Exporte o JSON para
              não perder o mapa.
            </p>
          )}
          <button type="button" onClick={onClearSaved}>
            Apagar dados salvos
          </button>
        </>
      )}
    </div>
  )
}
