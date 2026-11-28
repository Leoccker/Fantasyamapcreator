// React hook for bidirectional live synchronization between the browser editor and the local MCP LiveBridge.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LivePushResponse, LiveWorldEvent } from '../core/liveProtocol'
import { serializeWorld, type World } from '../core/world'

const STORAGE_KEY = 'fmc:mcp-live:v1'
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4175'

export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface LiveSyncController {
  state: LiveConnectionState
  url: string
  token: string
  paused: boolean
  autoFollow: boolean
  pendingCount: number
  error: string | null
  lastActivity: string | null
  conflict: string | null
  connect(url: string, token: string): void
  disconnect(): void
  togglePause(): void
  setAutoFollow(v: boolean): void
  pushWorld(world: World, reason?: string): void
  clearConflict(): void
}

interface StoredConfig {
  url: string
  token: string
  autoConnect: boolean
  autoFollow: boolean
}

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tab-${Math.random().toString(36).slice(2, 10)}`
}

function readInitialConfig(): StoredConfig {
  const fallback: StoredConfig = { url: DEFAULT_BRIDGE_URL, token: '', autoConnect: false, autoFollow: false }
  if (typeof window === 'undefined') return fallback

  // URL parameters (?mcp=...&token=...) take precedence and are immediately stripped from the address bar.
  const params = new URLSearchParams(window.location.search)
  const qUrl = params.get('mcp')?.trim()
  const qToken = params.get('token')?.trim()
  if (qUrl && qToken) {
    params.delete('mcp')
    params.delete('token')
    const rest = params.toString()
    const clean = `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', clean)
    const cfg: StoredConfig = { url: qUrl.replace(/\/+$/, ''), token: qToken, autoConnect: true, autoFollow: false }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
    } catch {
      // sessionStorage may be blocked in strict browser modes
    }
    return cfg
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredConfig>
      return {
        url: typeof parsed.url === 'string' && parsed.url ? parsed.url : DEFAULT_BRIDGE_URL,
        token: typeof parsed.token === 'string' ? parsed.token : '',
        autoConnect: Boolean(parsed.autoConnect && parsed.token),
        autoFollow: Boolean(parsed.autoFollow),
      }
    }
  } catch {
    // ignore storage errors
  }
  return fallback
}

function persistConfig(cfg: StoredConfig): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    // ignore storage errors
  }
}

export interface UseLiveSyncOptions {
  onRemoteWorld(event: LiveWorldEvent, follow: boolean): void
  onConflict?(message: string): void
}

export function useLiveSync({ onRemoteWorld, onConflict }: UseLiveSyncOptions): LiveSyncController {
  const [initial] = useState(readInitialConfig)
  const [url, setUrl] = useState(initial.url)
  const [token, setToken] = useState(initial.token)
  const [active, setActive] = useState(initial.autoConnect)
  const [state, setState] = useState<LiveConnectionState>(initial.autoConnect ? 'connecting' : 'disconnected')
  const [paused, setPaused] = useState(false)
  const [autoFollow, setAutoFollowState] = useState(initial.autoFollow)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  const clientIdRef = useRef<string>(makeClientId())
  const revRef = useRef(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const autoFollowRef = useRef(autoFollow)
  autoFollowRef.current = autoFollow
  const pendingEventRef = useRef<LiveWorldEvent | null>(null)
  const callbacksRef = useRef({ onRemoteWorld, onConflict })
  callbacksRef.current = { onRemoteWorld, onConflict }
  const connRef = useRef({ active, url, token, state })
  connRef.current = { active, url, token, state }

  // Serialized push queue (keeps only the latest pending snapshot if multiple edits happen while a POST is in flight).
  const pushingRef = useRef(false)
  const queuedPushRef = useRef<{ world: World; reason: string } | null>(null)

  useEffect(() => {
    if (!active || !url || !token || typeof EventSource === 'undefined') {
      setState('disconnected')
      return
    }
    const cleanUrl = url.replace(/\/+$/, '')
    const streamUrl = `${cleanUrl}/events?token=${encodeURIComponent(token)}`
    setState('connecting')
    setError(null)

    const es = new EventSource(streamUrl)

    es.onopen = () => {
      setState('connected')
      setError(null)
    }

    es.addEventListener('world', (rawEvent) => {
      try {
        const ev = JSON.parse((rawEvent as MessageEvent<string>).data) as LiveWorldEvent
        revRef.current = ev.rev
        if (ev.clientId && ev.clientId === clientIdRef.current) return
        if (!ev.worldJson) return

        if (pausedRef.current) {
          pendingEventRef.current = ev
          setPendingCount((n) => n + 1)
          return
        }

        setLastActivity(ev.highlight?.label ? `${ev.reason}: ${ev.highlight.label}` : ev.reason)
        callbacksRef.current.onRemoteWorld(ev, autoFollowRef.current)
      } catch {
        setError('Evento recebido do MCP está corrompido.')
      }
    })

    es.onerror = () => {
      setState('error')
      setError('Sem conexão com o servidor MCP (reconectando...).')
    }

    return () => {
      es.close()
    }
  }, [active, url, token])

  const flushPush = useCallback(async () => {
    if (pushingRef.current) return
    const next = queuedPushRef.current
    if (!next) return
    const { active: isActive, url: curUrl, token: curToken } = connRef.current
    if (!isActive || !curUrl || !curToken || pausedRef.current) {
      queuedPushRef.current = null
      return
    }

    queuedPushRef.current = null
    pushingRef.current = true
    try {
      const cleanUrl = curUrl.replace(/\/+$/, '')
      const res = await fetch(`${cleanUrl}/world`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${curToken}`,
        },
        body: JSON.stringify({
          worldJson: serializeWorld(next.world),
          baseRev: revRef.current,
          clientId: clientIdRef.current,
          reason: next.reason,
        }),
      })
      const data = (await res.json()) as LivePushResponse
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Falha ao sincronizar com MCP (HTTP ${res.status}).`)
      } else {
        revRef.current = data.rev
        setError(null)
        if (data.conflict) {
          const msg = 'Conflito de edição: sua alteração prevaleceu sobre uma atualização recente do MCP.'
          setConflict(msg)
          callbacksRef.current.onConflict?.(msg)
        }
      }
    } catch {
      setError('Não foi possível enviar a edição para o servidor MCP.')
    } finally {
      pushingRef.current = false
      if (queuedPushRef.current) void flushPush()
    }
  }, [])

  const pushWorld = useCallback(
    (world: World, reason = 'browser_edit') => {
      const { active: isActive, state: curState } = connRef.current
      if (!isActive || curState !== 'connected' || pausedRef.current) return
      queuedPushRef.current = { world, reason }
      void flushPush()
    },
    [flushPush],
  )

  const connect = useCallback((nextUrl: string, nextToken: string) => {
    const cleanUrl = nextUrl.trim().replace(/\/+$/, '')
    const cleanToken = nextToken.trim()
    if (!cleanUrl || !cleanToken) {
      setError('Informe a URL e o token do servidor MCP.')
      return
    }
    setUrl(cleanUrl)
    setToken(cleanToken)
    setPaused(false)
    pendingEventRef.current = null
    setPendingCount(0)
    setConflict(null)
    setError(null)
    setActive(true)
    persistConfig({ url: cleanUrl, token: cleanToken, autoConnect: true, autoFollow: autoFollowRef.current })
  }, [])

  const disconnect = useCallback(() => {
    setActive(false)
    setState('disconnected')
    setPaused(false)
    pendingEventRef.current = null
    queuedPushRef.current = null
    setPendingCount(0)
    setError(null)
    persistConfig({ url: connRef.current.url, token: connRef.current.token, autoConnect: false, autoFollow: autoFollowRef.current })
  }, [])

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev
      if (!next && pendingEventRef.current) {
        const queued = pendingEventRef.current
        pendingEventRef.current = null
        setPendingCount(0)
        setLastActivity(queued.highlight?.label ? `${queued.reason}: ${queued.highlight.label}` : queued.reason)
        // Apply on microtask so state updates cleanly outside the state updater.
        queueMicrotask(() => callbacksRef.current.onRemoteWorld(queued, autoFollowRef.current))
      }
      return next
    })
  }, [])

  const setAutoFollow = useCallback((v: boolean) => {
    setAutoFollowState(v)
    persistConfig({ url: connRef.current.url, token: connRef.current.token, autoConnect: connRef.current.active, autoFollow: v })
  }, [])

  const clearConflict = useCallback(() => setConflict(null), [])

  return {
    state,
    url,
    token,
    paused,
    autoFollow,
    pendingCount,
    error,
    lastActivity,
    conflict,
    connect,
    disconnect,
    togglePause,
    setAutoFollow,
    pushWorld,
    clearConflict,
  }
}
