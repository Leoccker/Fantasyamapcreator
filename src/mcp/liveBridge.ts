// Local HTTP + SSE bridge on 127.0.0.1 for real-time bidirectional sync between MapSession and the browser editor.
import crypto from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LiveHealthResponse, LivePushRequest, LivePushResponse, LiveWorldEvent } from '../core/liveProtocol'
import { parseWorld, serializeWorld } from '../core/world'
import type { MapSession, SessionChangeEvent } from './session'

export const DEFAULT_LIVE_PORT = 4175
export const DEFAULT_APP_URL = 'http://localhost:5173'
const MAX_BODY_BYTES = 20 * 1024 * 1024 // 20 MB safety cap for huge maps + custom icons
const HEARTBEAT_MS = 25_000
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

export interface LiveBridgeStartOptions {
  /** Preferred localhost port (default 4175). Pass 0 for an OS-assigned ephemeral port. */
  port?: number
  /** Session auth token (auto-generated if omitted). */
  token?: string
  /** Browser editor base URL used to build the clickable connectUrl. */
  appUrl?: string
  /** If true (default), falls back to an ephemeral port when the preferred port is busy. */
  fallbackToEphemeral?: boolean
}

export interface LiveBridgeStatus {
  running: boolean
  url: string | null
  port: number | null
  token: string | null
  clients: number
  appUrl: string
  connectUrl: string | null
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function buildConnectUrl(appUrl: string, bridgeUrl: string, token: string): string {
  const base = appUrl.replace(/\/+$/, '')
  return `${base}/?mcp=${encodeURIComponent(bridgeUrl)}&token=${encodeURIComponent(token)}`
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Corpo da requisição excedeu o limite permitido (20 MB).'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'))
      }
    })
    req.on('error', reject)
  })
}

export class LiveBridge {
  private server: http.Server | null = null
  private clients = new Set<ServerResponse>()
  private unsubSession: (() => void) | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private activePort: number | null = null
  private activeToken: string | null = null
  private activeAppUrl: string

  constructor(
    private readonly session: MapSession,
    defaultAppUrl = process.env.MAP_MCP_APP_URL ?? DEFAULT_APP_URL,
  ) {
    this.activeAppUrl = defaultAppUrl
  }

  get running(): boolean {
    return this.server !== null
  }

  status(): LiveBridgeStatus {
    const url = this.activePort !== null ? `http://127.0.0.1:${this.activePort}` : null
    const connectUrl = url && this.activeToken ? buildConnectUrl(this.activeAppUrl, url, this.activeToken) : null
    return {
      running: this.running,
      url,
      port: this.activePort,
      token: this.activeToken,
      clients: this.clients.size,
      appUrl: this.activeAppUrl,
      connectUrl,
    }
  }

  async start(opts: LiveBridgeStartOptions = {}): Promise<LiveBridgeStatus> {
    if (opts.appUrl) this.activeAppUrl = opts.appUrl
    if (this.server) return this.status()

    const preferredPort = opts.port ?? DEFAULT_LIVE_PORT
    const fallback = opts.fallbackToEphemeral ?? true
    const token = opts.token?.trim() || crypto.randomBytes(16).toString('hex')
    this.activeToken = token

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    const listenOn = (port: number) =>
      new Promise<number>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          server.off('error', onError)
          const addr = server.address() as AddressInfo | null
          resolve(addr?.port ?? port)
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })

    try {
      this.activePort = await listenOn(preferredPort)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (fallback && code === 'EADDRINUSE' && preferredPort !== 0) {
        this.activePort = await listenOn(0)
      } else {
        this.activeToken = null
        throw err
      }
    }

    this.server = server
    this.unsubSession = this.session.onChange((ev) => this.onSessionChange(ev))
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.writableEnded) client.write(': ping\n\n')
      }
    }, HEARTBEAT_MS)
    this.heartbeat.unref()

    return this.status()
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.unsubSession) {
      this.unsubSession()
      this.unsubSession = null
    }
    for (const client of this.clients) {
      if (!client.writableEnded) client.end()
    }
    this.clients.clear()

    const srv = this.server
    this.server = null
    this.activePort = null
    this.activeToken = null
    if (srv) {
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    }
  }

  private onSessionChange(ev: SessionChangeEvent): void {
    if (this.clients.size === 0) return
    const payload: LiveWorldEvent = {
      rev: ev.rev,
      source: ev.source,
      clientId: ev.clientId,
      reason: ev.reason,
      replaced: ev.replaced,
      worldJson: serializeWorld(ev.world),
      highlights: ev.highlights,
    }
    this.broadcast('world', payload)
  }

  private broadcast(eventName: string, data: unknown): void {
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of [...this.clients]) {
      if (client.writableEnded) {
        this.clients.delete(client)
        continue
      }
      client.write(frame)
    }
  }

  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin
    if (origin && LOOPBACK_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    }
  }

  private isAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!this.activeToken) return false
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      return safeEqual(auth.slice(7).trim(), this.activeToken)
    }
    const queryToken = url.searchParams.get('token')
    if (queryToken) return safeEqual(queryToken, this.activeToken)
    return false
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.activePort ?? 0}`)
    if (!this.isAuthorized(req, url)) {
      this.sendJson(res, 401, { ok: false, error: 'Token de sessão inválido ou ausente.' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      const payload: LiveHealthResponse = {
        ok: true,
        rev: this.session.rev,
        hasWorld: this.session.world !== null,
        clients: this.clients.size,
      }
      this.sendJson(res, 200, payload)
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders?.()
      this.clients.add(res)

      const initial: LiveWorldEvent = {
        rev: this.session.rev,
        source: 'mcp',
        reason: 'sync',
        replaced: true,
        worldJson: this.session.world ? serializeWorld(this.session.world) : null,
      }
      res.write(`event: world\ndata: ${JSON.stringify(initial)}\n\n`)

      req.on('close', () => {
        this.clients.delete(res)
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/world') {
      try {
        const body = (await readJsonBody(req)) as Partial<LivePushRequest>
        if (typeof body.worldJson !== 'string' || !body.worldJson.trim()) {
          this.sendJson(res, 400, { ok: false, rev: this.session.rev, conflict: false, error: 'Campo `worldJson` obrigatório.' })
          return
        }
        const parsed = parseWorld(body.worldJson)
        const prevRev = this.session.rev
        const conflict = typeof body.baseRev === 'number' && body.baseRev !== prevRev
        const applied = this.session.applyExternal(parsed, {
          source: 'browser',
          clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
          reason: typeof body.reason === 'string' ? body.reason : 'browser_edit',
        })
        const resp: LivePushResponse = { ok: true, rev: applied.rev, conflict }
        this.sendJson(res, 200, resp)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const resp: LivePushResponse = { ok: false, rev: this.session.rev, conflict: false, error: message }
        this.sendJson(res, 400, resp)
      }
      return
    }

    this.sendJson(res, 404, { ok: false, error: 'Endpoint não encontrado.' })
  }
}
