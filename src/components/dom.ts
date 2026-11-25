/** True when a key event comes from a form field, so global shortcuts must ignore it. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/** A number typed by a person: accepts a decimal comma ("0,5"); null for empty or invalid text. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
