import { afterEach, describe, expect, it } from 'vitest'
import { generate } from '../core/generate'
import { addMarker } from '../core/items'
import type { LiveWorldEvent } from '../core/liveProtocol'
import { parseWorld, serializeWorld } from '../core/world'
import { LiveBridge } from './liveBridge'
import { MapSession } from './session'

async function openSse(url: string): Promise<{ nextEvent(): Promise<LiveWorldEvent>; close(): void }> {
  const controller = new AbortController()
  const res = await fetch(url, { signal: controller.signal })
  if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const queue: LiveWorldEvent[] = []
  const waiters: ((ev: LiveWorldEvent) => void)[] = []

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx = buffer.indexOf('\n\n')
        while (idx !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const dataLine = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n')
          if (dataLine) {
            const parsed = JSON.parse(dataLine) as LiveWorldEvent
            const waiter = waiters.shift()
            if (waiter) waiter(parsed)
            else queue.push(parsed)
          }
          idx = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // stream closed on teardown
    }
  }
  void pump()

  return {
    nextEvent() {
      const queued = queue.shift()
      if (queued) return Promise.resolve(queued)
      return new Promise<LiveWorldEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for SSE event')), 4000)
        waiters.push((ev) => {
          clearTimeout(timer)
          resolve(ev)
        })
      })
    },
    close() {
      controller.abort()
    },
  }
}

describe('LiveBridge', () => {
  const bridges: LiveBridge[] = []

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((b) => b.stop()))
  })

  it('enforces auth, loopback CORS, streams MCP edits via SSE, and accepts browser edits with conflict detection', async () => {
    const session = new MapSession()
    const bridge = new LiveBridge(session, 'http://localhost:5173')
    bridges.push(bridge)

    const status = await bridge.start({ port: 0 })
    expect(status.running).toBe(true)
    expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(status.token).toBeTruthy()
    expect(status.connectUrl).toContain('http://localhost:5173/?mcp=')

    // 1. Auth required
    const unauth = await fetch(`${status.url}/health`)
    expect(unauth.status).toBe(401)

    const wrongToken = await fetch(`${status.url}/health`, { headers: { Authorization: 'Bearer wrong' } })
    expect(wrongToken.status).toBe(401)

    // 2. Authorized health + strict loopback CORS
    const okHealth = await fetch(`${status.url}/health`, {
      headers: { Authorization: `Bearer ${status.token}`, Origin: 'http://localhost:5173' },
    })
    expect(okHealth.status).toBe(200)
    expect(okHealth.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(await okHealth.json()).toEqual({ ok: true, rev: 0, hasWorld: false, clients: 0 })

    const evilCors = await fetch(`${status.url}/health`, {
      headers: { Authorization: `Bearer ${status.token}`, Origin: 'https://evil.example' },
    })
    expect(evilCors.headers.get('access-control-allow-origin')).toBeNull()

    // 3. Connect SSE client and receive initial sync
    const sse = await openSse(`${status.url}/events?token=${encodeURIComponent(status.token!)}`)
    try {
      const initial = await sse.nextEvent()
      expect(initial.rev).toBe(0)
      expect(initial.worldJson).toBeNull()

      // 4. MCP generates world -> pushed over SSE
      const w1 = generate({ seed: 'bridge-test', width: 1000, height: 625, cellCount: 1500, continents: 2, waterPct: 55, kingdoms: 2 })
      session.setWorld(w1, null, { reason: 'generate_world' })

      const genEv = await sse.nextEvent()
      expect(genEv.rev).toBe(1)
      expect(genEv.source).toBe('mcp')
      expect(genEv.reason).toBe('generate_world')
      expect(genEv.replaced).toBe(true)
      expect(genEv.worldJson).toBeTruthy()
      expect(parseWorld(genEv.worldJson!).seed).toBe('bridge-test')

      // 5. MCP edits with highlight -> pushed over SSE with highlight metadata
      session.edit((w) => addMarker(w, 'port', 420, 260)[0], {
        reason: 'manage_markers',
        highlight: { kind: 'point', x: 420, y: 260, label: 'Porto Vivo' },
      })
      const editEv = await sse.nextEvent()
      expect(editEv.rev).toBe(2)
      expect(editEv.replaced).toBe(false)
      expect(editEv.highlight).toEqual({ kind: 'point', x: 420, y: 260, label: 'Porto Vivo' })

      // 6. Browser pushes edit cleanly (matching baseRev -> conflict: false)
      const [browserEdited] = addMarker(session.world!, 'castle', 500, 320)
      const pushRes = await fetch(`${status.url}/world`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${status.token}`,
        },
        body: JSON.stringify({
          worldJson: serializeWorld(browserEdited),
          baseRev: 2,
          clientId: 'tab-1',
          reason: 'browser_edit',
        }),
      })
      expect(pushRes.status).toBe(200)
      const pushBody = await pushRes.json()
      expect(pushBody).toEqual({ ok: true, rev: 3, conflict: false })
      expect(session.world?.markers.length).toBe(browserEdited.markers.length)

      // Broadcast includes clientId so tab-1 can ignore its own echo
      const echoEv = await sse.nextEvent()
      expect(echoEv.rev).toBe(3)
      expect(echoEv.clientId).toBe('tab-1')

      // Browser edit is undoable in MapSession
      expect(session.undo().changed).toBe(true)
      expect(session.world?.markers.length).toBe(browserEdited.markers.length - 1)
      await sse.nextEvent() // rev 4 (undo)

      // 7. Browser pushes with stale baseRev -> last-write-wins with conflict: true
      const stalePush = await fetch(`${status.url}/world`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${status.token}`,
        },
        body: JSON.stringify({
          worldJson: serializeWorld(browserEdited),
          baseRev: 2, // stale; session is at rev 4
          clientId: 'tab-1',
        }),
      })
      const staleBody = await stalePush.json()
      expect(staleBody).toEqual({ ok: true, rev: 5, conflict: true })
    } finally {
      sse.close()
    }
  })
})
