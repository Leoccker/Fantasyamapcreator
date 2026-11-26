import { useRef } from 'react'
import type { SaveResult } from '../core/autosave'

export interface FileActionsProps {
  onExportPng(): void
  onExportSvg(): void
  onExportJson(): void
  onImport(file: File): void
}

export function FileActions({ onExportPng, onExportSvg, onExportJson, onImport }: FileActionsProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="file-actions">
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
    </div>
  )
}

export interface AutosaveProps {
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

/** The "ⓘ" menu about saving in this browser, plus the autosave error, which is always shown (never inside the menu). */
export function AutosaveInfo({ autosave, onClearSaved }: AutosaveProps) {
  const failing = autosave.available && autosave.failing && !autosave.failing.ok ? autosave.failing : null
  return (
    <>
      {failing && (
        <p className="hint error" role="alert">
          {failing.reason === 'quota' ? 'O autosave parou: o armazenamento está cheio.' : 'O autosave está falhando.'} Exporte o JSON para não
          perder o mapa.
        </p>
      )}
      <details className="pop">
        <summary aria-label="Sobre o salvamento" title="Sobre o salvamento">
          ⓘ
        </summary>
        <div className="pop-body">
          {!autosave.available ? (
            <p className="hint">Este navegador não permite salvar dados locais: o mapa não é salvo sozinho. Exporte o JSON para guardar.</p>
          ) : (
            <>
              <p className="hint">
                O mapa, com suas notas, é salvo sozinho neste navegador.
                {autosave.backup && ' Há também uma cópia de um autosave antigo que não pôde ser aberto.'}
              </p>
              <button type="button" onClick={onClearSaved}>
                Apagar dados salvos
              </button>
            </>
          )}
        </div>
      </details>
    </>
  )
}
