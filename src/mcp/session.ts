// In-memory editing session for the MCP server: active World, undo/redo history, revision tracking, and safe path resolution.
import os from 'node:os'
import path from 'node:path'
import { createHistory, type History } from '../core/history'
import { reuseUnchangedWorldData, type LiveHighlight } from '../core/liveProtocol'
import type { World } from '../core/world'

export interface SessionStatus {
  hasWorld: boolean
  filePath: string | null
  canUndo: boolean
  canRedo: boolean
}

export interface SessionEditMeta {
  reason?: string
  source?: 'mcp' | 'browser'
  clientId?: string
  highlights?: LiveHighlight[]
}

export interface SessionChangeEvent {
  rev: number
  world: World
  source: 'mcp' | 'browser'
  clientId?: string
  reason: string
  replaced: boolean
  highlights?: LiveHighlight[]
}

export class MapSession {
  private current: World | null = null
  private path: string | null = null
  private history: History<World>
  private revision = 0
  private listeners = new Set<(event: SessionChangeEvent) => void>()

  constructor(historyLimit = 50) {
    this.history = createHistory<World>(historyLimit)
  }

  get world(): World | null {
    return this.current
  }

  get filePath(): string | null {
    return this.path
  }

  get rev(): number {
    return this.revision
  }

  onChange(listener: (event: SessionChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(world: World, replaced: boolean, meta: SessionEditMeta = {}): void {
    this.revision++
    const event: SessionChangeEvent = {
      rev: this.revision,
      world,
      source: meta.source ?? 'mcp',
      clientId: meta.clientId,
      reason: meta.reason ?? (replaced ? 'replace' : 'edit'),
      replaced,
      highlights: meta.highlights,
    }
    for (const listener of this.listeners) listener(event)
  }

  requireWorld(): World {
    if (!this.current) {
      throw new Error('Nenhum mapa ativo na sessão. Use `generate_world` para criar um mapa ou `load_world` para carregar um arquivo JSON.')
    }
    return this.current
  }

  setWorld(world: World, filePath: string | null = null, meta?: SessionEditMeta): void {
    this.current = world
    this.path = filePath
    this.history.clear()
    this.emit(world, true, meta)
  }

  setFilePath(filePath: string): void {
    this.path = filePath
  }

  edit(fn: (world: World) => World, meta?: SessionEditMeta): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const next = fn(prev)
    if (next === prev) return { world: prev, changed: false }
    this.history.push(prev)
    this.current = next
    this.emit(next, false, meta)
    return { world: next, changed: true }
  }

  /**
   * Applies an external World update (e.g. from the live-preview browser editor).
   * Preserves undo history when editing the same map topology; replaces history when the map itself changed.
   */
  applyExternal(world: World, meta: SessionEditMeta = {}): { world: World; rev: number; replaced: boolean } {
    const prev = this.current
    const merged = reuseUnchangedWorldData(prev, world)
    const replaced = !prev || merged.points !== prev.points
    if (replaced) {
      this.history.clear()
    } else if (prev) {
      this.history.push(prev)
    }
    this.current = merged
    this.emit(merged, replaced, { source: 'browser', reason: 'browser_edit', ...meta })
    return { world: merged, rev: this.revision, replaced }
  }

  undo(meta?: SessionEditMeta): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const restored = this.history.undo(prev)
    if (!restored) return { world: prev, changed: false }
    this.current = restored
    this.emit(restored, false, { reason: 'undo', ...meta })
    return { world: restored, changed: true }
  }

  redo(meta?: SessionEditMeta): { world: World; changed: boolean } {
    const prev = this.requireWorld()
    const restored = this.history.redo(prev)
    if (!restored) return { world: prev, changed: false }
    this.current = restored
    this.emit(restored, false, { reason: 'redo', ...meta })
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
  const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir())
  if (!rootDir) return path.resolve(expanded)
  const base = path.resolve(rootDir)
  const resolved = path.resolve(base, expanded)
  const rel = path.relative(base, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Caminho "${inputPath}" fora do diretório permitido (${base}).`)
  }
  return resolved
}
