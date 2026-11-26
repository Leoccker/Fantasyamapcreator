interface Props {
  onConfirm(): void
  onCancel(): void
}

/**
 * "Discard hand edits?" strip under the top bar. Replaces window.confirm, which embedded browsers and some
 * sandboxes block (it returns false instantly, so the action silently did nothing).
 */
export function ConfirmDiscard({ onConfirm, onCancel }: Props) {
  return (
    <div className="confirm" role="alertdialog" aria-labelledby="confirm-text">
      <p id="confirm-text">O mapa tem edições à mão que serão perdidas. Continuar?</p>
      <div className="row">
        {/* autoFocus: the action that asked may be in the panel or the top bar; the answer is here */}
        <button type="button" onClick={onConfirm} autoFocus>
          Descartar edições
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
