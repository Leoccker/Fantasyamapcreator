// Autosave to a key-value store (localStorage in the app, a Map in tests). Storage and clock are injected, so
// this stays testable in node; the only platform timer used is setTimeout, for the debounce.
// The map is stored exactly as an exported JSON file, so parseWorld stays the only validator and migrator.
import { parseWorld, serializeWorld, type World } from './world'

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const KEY = 'fmc.autosave'
/** { edited, savedAt }: whether the map holds hand edits (incl. sculpting, which leaves no other trace). */
export const META = 'fmc.autosave.meta'
/** A save that couldn't be loaded (corrupt or from a newer version) is copied here, never thrown away. */
export const BACKUP = 'fmc.autosave.backup'

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'error' }

const isQuota = (e: unknown) =>
  e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')

/** Writes the map. Never throws; a failed write leaves the previous save in place. */
export function saveAutosave(s: KV, w: World, edited: boolean, now: number): SaveResult {
  try {
    s.setItem(KEY, serializeWorld(w))
    s.setItem(META, JSON.stringify({ edited, savedAt: now }))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: isQuota(e) ? 'quota' : 'error' }
  }
}

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'ok'; world: World; edited: boolean; savedAt: number | null }
  | { kind: 'bad'; reason: string; backedUp: boolean }

export function loadAutosave(s: KV): LoadResult {
  let raw: string | null
  try {
    raw = s.getItem(KEY)
  } catch {
    return { kind: 'none' }
  }
  if (raw === null) return { kind: 'none' }
  try {
    const world = parseWorld(raw)
    // Missing or broken meta: assume edited, so regenerating still asks before discarding the map.
    let edited = true
    let savedAt: number | null = null
    try {
      const m = JSON.parse(s.getItem(META) ?? 'null')
      if (typeof m?.edited === 'boolean') edited = m.edited
      if (typeof m?.savedAt === 'number' && Number.isFinite(m.savedAt)) savedAt = m.savedAt
    } catch {
      // keep the safe defaults
    }
    return { kind: 'ok', world, edited, savedAt }
  } catch (e) {
    // Keep the unreadable save (it may be from a newer version of the app). Writing the same copy twice is
    // harmless, so React StrictMode running this twice gives the same answer.
    let backedUp = false
    try {
      if (s.getItem(BACKUP) !== raw) s.setItem(BACKUP, raw)
      backedUp = true
    } catch {
      backedUp = false
    }
    return { kind: 'bad', reason: (e as Error).message, backedUp }
  }
}

/** Removes everything this app stored, including the backup of an unreadable save. */
export function clearAutosave(s: KV): void {
  for (const k of [KEY, META, BACKUP]) {
    try {
      s.removeItem(k)
    } catch {
      // nothing to clear
    }
  }
}

/** Whether an unreadable save is being kept aside (the user should know it is still stored). */
export function hasBackup(s: KV): boolean {
  try {
    return s.getItem(BACKUP) !== null
  } catch {
    return false
  }
}

export interface Autosaver {
  /** Saves `w` after `delayMs` of quiet; a newer request replaces a pending one. */
  request(w: World, edited: boolean): void
  /** Saves a pending request now (page hidden or closing). */
  flush(): void
  /** Cancels a pending save, removes everything stored, and resumes saving (also after disable()). */
  clear(): void
  /** Stops saving until clear() (used when an unreadable save couldn't be backed up, so it is never overwritten). */
  disable(): void
}

export function createAutosaver(s: KV | null, onResult: (r: SaveResult) => void, now: () => number, delayMs = 1000): Autosaver {
  let pending: { w: World; edited: boolean } | null = null
  let lastSaved: { w: World; edited: boolean } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let disabled = !s

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!pending || disabled || !s) return
    const job = pending
    pending = null
    const r = saveAutosave(s, job.w, job.edited, now())
    if (r.ok) lastSaved = job
    onResult(r)
  }

  return {
    request(w, edited) {
      if (disabled) return
      if (lastSaved && lastSaved.w === w && lastSaved.edited === edited) return // already stored
      pending = { w, edited }
      clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush,
    clear() {
      clearTimeout(timer)
      pending = null
      lastSaved = null
      if (s) clearAutosave(s)
      disabled = !s // the user removed what we were protecting: saving may resume
    },
    disable() {
      disabled = true
      clearTimeout(timer)
      pending = null
    },
  }
}
