// Generic undo/redo. Snapshots are whole immutable states (e.g. World references), so nothing is copied.

export interface History<T> {
  /** Records `current` (the state before an edit) and clears redo. */
  push(current: T): void
  undo(current: T): T | null
  redo(current: T): T | null
  clear(): void
  canUndo(): boolean
  canRedo(): boolean
}

export function createHistory<T>(limit = 50): History<T> {
  const past: T[] = []
  let future: T[] = []
  return {
    push(current) {
      past.push(current)
      if (past.length > limit) past.shift()
      future = []
    },
    undo(current) {
      const prev = past.pop()
      if (prev === undefined) return null
      future.push(current)
      return prev
    },
    redo(current) {
      const next = future.pop()
      if (next === undefined) return null
      past.push(current)
      return next
    },
    clear() {
      past.length = 0
      future = []
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  }
}
