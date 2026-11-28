// In-memory editing session for the MCP server: active World, undo/redo history, and safe path resolution.
import path from 'node:path'
import { createHistory, type History } from '../core/history'
import type { World } from '../core/world'

export interface SessionStatus {
  hasWorld: boolean
  filePath: string | null
  canUndo: boolean
  canRedo: boolean
}

export class MapSession {
  private current: World | null = null
  private path: string | null = null
  private history: History<World>

  constructor(historyLimit = 50) {
    this.history = createHistory<World>(historyLimit)
  }

  get world(): World | null {
    return this.current
  }

  get filePath(): string | null {
    return this.path
  }

  requireWorld(): World {
    if (!this.current) {
      throw new Error('Nenhum mapa ativo na sessão. Use `generate_world` para criar um mapa ou `load_world` para carregar um arquivo JSON.')
    }
    return this.current
  }

  setWorld(world: World, filePath: string | null = null): void {
    this.current = world
    this.path = filePath
    this.history.clear()
  }

  setFilePath(filePath: string): void {
    this.path = filePath
  }

  edit(fn: (world: World) => World): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const next = fn(prev)
    if (next === prev) return { world: prev, changed: false }
    this.history.push(prev)
    this.current = next
    return { world: next, changed: true }
  }

  undo(): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const restored = this.history.undo(prev)
    if (!restored) return { world: prev, changed: false }
    this.current = restored
    return { world: restored, changed: true }
  }

  redo(): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const restored = this.history.redo(prev)
    if (!restored) return { world: prev, changed: false }
    this.current = restored
    return { world: restored, changed: true }
  }

  status(): SessionStatus {
    return {
      hasWorld: this.current !== null,
      filePath: this.path,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
    }
  }
}

/**
 * Resolves a file path safely. When `rootDir` (e.g. MAP_MCP_WORKDIR) is set, relative paths are anchored to it
 * and any path escaping `rootDir` is rejected.
 */
export function resolveSafePath(inputPath: string, rootDir?: string): string {
  const trimmed = inputPath.trim()
  if (!trimmed) throw new Error('Caminho de arquivo vazio.')
  if (!rootDir) return path.resolve(trimmed)
  const base = path.resolve(rootDir)
  const resolved = path.resolve(base, trimmed)
  const rel = path.relative(base, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Caminho "${inputPath}" fora do diretório permitido (${base}).`)
  }
  return resolved
}
