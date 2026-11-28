import { describe, expect, it } from 'vitest'
import { generate } from '../core/generate'
import type { LiveWorldEvent } from '../core/liveProtocol'
import { queueLocalPush, receiveRemoteEvent, resumeSync, type LiveSyncBuffer } from './useLiveSync'

const world = generate({ seed: 'sync-test', width: 800, height: 500, continents: 2, waterPct: 55, cellCount: 1000, kingdoms: 1 })

const remoteEvent = (rev: number): LiveWorldEvent => ({
  rev,
  source: 'mcp',
  reason: 'manage_markers',
  replaced: false,
  worldJson: '{"placeholder":true}',
})

describe('useLiveSync pause/resume buffer', () => {
  it('pushes local edits on resume, drops held-back remote updates, and keeps pre-pause rev for conflict detection', () => {
    const buf: LiveSyncBuffer = { rev: 3, paused: true, pendingRemote: null, queuedPush: null }

    expect(receiveRemoteEvent(buf, remoteEvent(4), 'tab-1')).toBe('queued')
    expect(buf.rev).toBe(3)
    expect(buf.pendingRemote?.rev).toBe(4)

    expect(queueLocalPush(buf, world, 'browser_edit')).toBe(false)
    expect(buf.queuedPush?.world).toBe(world)

    const resumed = resumeSync(buf)
    expect(resumed).toEqual({ action: 'push' })
    expect(buf.paused).toBe(false)
    expect(buf.pendingRemote).toBeNull()
    expect(buf.rev).toBe(3) // stale vs server rev 4 so the server reports a conflict
    expect(buf.queuedPush?.world).toBe(world)
  })

  it('applies the held-back remote update and advances rev when no local edit happened during pause', () => {
    const buf: LiveSyncBuffer = { rev: 3, paused: true, pendingRemote: null, queuedPush: null }
    const ev = remoteEvent(5)

    expect(receiveRemoteEvent(buf, ev, 'tab-1')).toBe('queued')
    expect(buf.rev).toBe(3)

    const resumed = resumeSync(buf)
    expect(resumed).toEqual({ action: 'apply', event: ev })
    expect(buf.paused).toBe(false)
    expect(buf.rev).toBe(5)
    expect(buf.pendingRemote).toBeNull()
  })

  it('queues and pushes local edits on resume even when no remote event arrived during pause', () => {
    const buf: LiveSyncBuffer = { rev: 3, paused: true, pendingRemote: null, queuedPush: null }

    expect(queueLocalPush(buf, world, 'browser_edit')).toBe(false)
    expect(resumeSync(buf)).toEqual({ action: 'push' })
    expect(buf.rev).toBe(3)
    expect(buf.queuedPush?.world).toBe(world)
  })
})
