import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { parseNumber } from './dom'

interface Props {
  label: string
  value: string
  /** For type 'number', receives the parsed number as a string ("0,5" arrives as "0.5"). */
  onCommit(value: string): void
  type?: 'text' | 'number' | 'color'
  multiline?: boolean
  maxLength?: number
  /** Id of a hint that describes this field. */
  describedBy?: string
}

/**
 * An input that keeps its own draft and commits on blur or Enter (Esc reverts), so typing a name is one
 * undo step, not one per keystroke. Remount it (key) when it starts editing another item.
 * Number fields accept a decimal comma; invalid text is refused with a message instead of being ignored.
 */
export function DraftInput({ label, value, onCommit, type = 'text', multiline, maxLength, describedBy }: Props) {
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  const [error, setError] = useState('')
  const errorId = useId()
  if (value !== lastValue) {
    // The item changed underneath (undo/redo): show the new value.
    setLastValue(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft === value) return setError('')
    let out = draft
    if (type === 'number') {
      const n = parseNumber(draft)
      if (n === null) {
        setError('Digite um número.')
        return setDraft(value)
      }
      out = String(n)
    }
    setError('')
    if (out !== value) onCommit(out)
    // If the edit was clamped back to the current value (or refused), show what is really stored.
    setDraft(value)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setDraft(value)
    else if (e.key === 'Enter' && !multiline) (e.target as HTMLElement).blur()
  }
  // A color picked in the native popup must not wait for blur (it could be lost by clicking elsewhere).
  // React's onChange fires on every drag of the picker; the native `change` fires once, when it closes.
  const colorRef = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onCommit })
  latest.current = { value, onCommit }
  useEffect(() => {
    const el = colorRef.current
    if (!el) return
    const onNativeChange = () => {
      if (el.value !== latest.current.value) latest.current.onCommit(el.value)
    }
    el.addEventListener('change', onNativeChange)
    return () => el.removeEventListener('change', onNativeChange)
  }, [])
  const common = {
    value: draft,
    onBlur: commit,
    onKeyDown: onKey,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [describedBy, error && errorId].filter(Boolean).join(' ') || undefined,
  }

  return (
    <label>
      {label}
      {multiline ? (
        <textarea rows={4} {...common} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input
          ref={type === 'color' ? colorRef : undefined}
          // A text field with a decimal keypad: type="number" drops "0,5" silently in many locales.
          type={type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          {...common}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}
