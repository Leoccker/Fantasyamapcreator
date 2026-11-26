import { useEffect, useState, type ReactNode } from 'react'
import { browserStorage } from './useAutosave'

const key = (id: string) => `fmc.section.${id}`

function read(id: string, fallback: boolean) {
  try {
    const v = browserStorage()?.getItem(key(id))
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function write(id: string, open: boolean) {
  try {
    browserStorage()?.setItem(key(id), open ? '1' : '0')
  } catch {
    // only a preference: forgetting it is harmless
  }
}

interface Props {
  /** Storage key for the remembered open/closed state. */
  id: string
  title: string
  defaultOpen?: boolean
  /** Opens the section whenever this changes to a truthy value (e.g. a selection whose editor lives here). */
  openWhen?: unknown
  children: ReactNode
}

/** A collapsible side-panel group (<details> is a named group for screen readers); remembers if it was open. */
export function Section({ id, title, defaultOpen = false, openWhen, children }: Props) {
  const [open, setOpen] = useState(() => read(id, defaultOpen))
  useEffect(() => {
    if (openWhen) setOpen(true)
  }, [openWhen])
  return (
    <details
      className="section"
      open={open}
      onToggle={(e) => {
        const o = e.currentTarget.open
        setOpen(o)
        write(id, o)
      }}
    >
      <summary>{title}</summary>
      {children}
    </details>
  )
}
