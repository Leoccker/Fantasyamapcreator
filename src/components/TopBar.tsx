import { AutosaveInfo, FileActions, type AutosaveProps, type FileActionsProps } from './FileActions'
import { StatusMessage, type Status } from './StatusMessage'

type Props = FileActionsProps &
  AutosaveProps & {
    canUndo: boolean
    canRedo: boolean
    onUndo(): void
    onRedo(): void
    status: Status
  }

const SHORTCUTS = [
  'Roda do mouse: zoom',
  'Espaço + arrastar ou botão do meio: mover',
  'Selecionar: clique escolhe, arrastar move marcadores e rótulos',
  'Com o mapa focado: setas movem, + e − dão zoom, 0 volta ao mapa inteiro, Esc cancela, Delete apaga o selecionado',
  'Ctrl+Z desfaz, Ctrl+Shift+Z ou Ctrl+Y refaz',
  'Pincéis e marcadores precisam de mouse, caneta ou toque.',
]

/** Always visible: files, undo/redo, the status line (the app's live region: keep it mounted) and the help menus. */
export function TopBar({ onExportPng, onExportSvg, onExportJson, onImport, autosave, onClearSaved, canUndo, canRedo, onUndo, onRedo, status }: Props) {
  return (
    <header className="topbar">
      <h1>Criador de Mapas</h1>
      <FileActions onExportPng={onExportPng} onExportSvg={onExportSvg} onExportJson={onExportJson} onImport={onImport} />
      <div className="row">
        <button type="button" disabled={!canUndo} onClick={onUndo} title="Ctrl+Z">
          Desfazer
        </button>
        <button type="button" disabled={!canRedo} onClick={onRedo} title="Ctrl+Shift+Z ou Ctrl+Y">
          Refazer
        </button>
      </div>
      <StatusMessage status={status} />
      <AutosaveInfo autosave={autosave} onClearSaved={onClearSaved} />
      <details className="pop">
        <summary aria-label="Atalhos do teclado" title="Atalhos do teclado">
          ?
        </summary>
        <ul className="pop-body shortcuts">
          {SHORTCUTS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </header>
  )
}
