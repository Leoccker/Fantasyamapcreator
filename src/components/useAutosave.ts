import { useEffect, useState, type RefObject } from 'react'
import { createAutosaver, hasBackup, loadAutosave, type KV, type SaveResult } from '../core/autosave'
import type { World } from '../core/world'
import type { Status } from './StatusMessage'

/** localStorage, or null where it is unavailable (it can throw, e.g. with site data blocked). */
export function browserStorage(): KV | null {
  try {
    const s = window.localStorage
    s.getItem('fmc.probe')
    return s
  } catch {
    return null
  }
}

export interface Boot {
  world: World
  status: Status
  /** The restored map holds hand edits (so regenerating asks first). */
  edited: boolean
  /** False when an unreadable save couldn't be backed up: saving would destroy it. */
  canSave: boolean
}

/** The map to start with: the autosave if there is a readable one, otherwise `fresh()`. */
export function bootFromAutosave(storage: KV | null, fresh: () => [World, Status]): Boot {
  const saved = storage ? loadAutosave(storage) : ({ kind: 'none' } as const)
  if (saved.kind === 'ok') {
    const when = saved.savedAt ? ` (salvo em ${new Date(saved.savedAt).toLocaleString('pt-BR')})` : ''
    return { world: saved.world, status: { text: `Mapa restaurado do autosave${when}.`, error: false }, edited: saved.edited, canSave: true }
  }
  const [world, status] = fresh()
  if (saved.kind === 'none') return { world, status, edited: false, canSave: true }
  const reason = saved.reason.replace(/\.$/, '')
  const kept = saved.backedUp
    ? 'Uma cópia foi guardada neste navegador; "Apagar dados salvos" remove.'
    : 'O autosave foi pausado para não apagá-lo; use "Apagar dados salvos" para voltar a salvar.'
  return { world, status: { text: `Não foi possível abrir o autosave (${reason}). ${kept}`, error: true }, edited: false, canSave: saved.backedUp }
}

/**
 * Saves `world` about 1 s after each change, and right away when the page is hidden or closed.
 * `failing` stays true while saves fail, so the panel can keep showing it (a status line would be overwritten).
 */
export function useAutosave(storage: KV | null, world: World, edited: RefObject<boolean>, canSave: boolean) {
  const [failing, setFailing] = useState<SaveResult | null>(null)
  const [saver] = useState(() => {
    const s = createAutosaver(storage, (r) => setFailing(r.ok ? null : r), Date.now)
    if (!canSave) s.disable()
    return s
  })
  const [backup, setBackup] = useState(() => !!storage && hasBackup(storage))

  useEffect(() => {
    saver.request(world, edited.current)
  }, [saver, world, edited])

  useEffect(() => {
    const flushIfHidden = () => document.visibilityState === 'hidden' && saver.flush()
    window.addEventListener('pagehide', saver.flush)
    document.addEventListener('visibilitychange', flushIfHidden)
    return () => {
      window.removeEventListener('pagehide', saver.flush)
      document.removeEventListener('visibilitychange', flushIfHidden)
    }
  }, [saver])

  return {
    /** Unavailable storage, or a save failing (quota or browser error). */
    failing: storage ? failing : ({ ok: false, reason: 'error' } as const),
    /** An unreadable save is being kept aside in this browser. */
    backup,
    /** Removes everything stored in this browser and resumes saving with the next edit. */
    clear() {
      saver.clear()
      setFailing(null)
      setBackup(false)
    },
  }
}
