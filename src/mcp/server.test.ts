import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWorld } from '../core/world'
import { createMapMcpServer } from './server'

function parseTextContent(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as { type: string; text?: string }[]
  const text = content.find((c) => c.type === 'text')?.text
  expect(text).toBeDefined()
  return JSON.parse(text!)
}

describe('MCP server end-to-end', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function setupClient(workdir?: string) {
    const { server, session, liveBridge } = createMapMcpServer({ workdir })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.1.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return { client, server, session, liveBridge }
  }

  it('exposes all 15 tools and runs a full worldbuilding workflow', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fmc-mcp-'))
    tempDirs.push(dir)
    const { client, session, liveBridge } = await setupClient(dir)

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'brush_stroke',
      'find_locations',
      'generate_world',
      'inspect_world',
      'live_preview',
      'load_world',
      'manage_kingdoms',
      'manage_labels',
      'manage_markers',
      'regenerate_kingdoms',
      'render_preview',
      'sample_point',
      'save_world',
      'undo_redo',
      'update_settings',
    ])

    // Calling inspect_world without a world returns an MCP tool error.
    const emptyRes = await client.callTool({ name: 'inspect_world', arguments: {} })
    expect(emptyRes.isError).toBe(true)

    // 1. Generate world
    const gen = parseTextContent(
      await client.callTool({
        name: 'generate_world',
        arguments: { seed: 'mcp-e2e', size: 'small', continents: 2, waterPct: 55, kingdoms: 3, title: 'Terras de Aethel' },
      }),
    )
    expect(gen.ok).toBe(true)
    expect(gen.summary.meta.width).toBe(1000)
    expect(gen.summary.kingdoms.length).toBe(3)
    expect(gen.summary.settings.title).toBe('Terras de Aethel')

    // 2. Find coastal locations and sample one
    const coasts = parseTextContent(
      await client.callTool({ name: 'find_locations', arguments: { terrain: 'coast', limit: 3 } }),
    )
    expect(coasts.locations.length).toBeGreaterThan(0)
    const portPos = coasts.locations[0]

    const sampled = parseTextContent(
      await client.callTool({ name: 'sample_point', arguments: { x: portPos.x, y: portPos.y } }),
    )
    expect(sampled.isLand).toBe(true)
    expect(sampled.isCoast).toBe(true)

    // 3. Sculpt terrain and paint a fantasy biome
    const sculpt = parseTextContent(
      await client.callTool({
        name: 'brush_stroke',
        arguments: {
          tool: 'raise',
          points: [
            { x: portPos.x, y: portPos.y },
            { x: portPos.x + 25, y: portPos.y + 10 },
          ],
          radius: 40,
          strength: 0.7,
          passes: 2,
        },
      }),
    )
    expect(sculpt.ok).toBe(true)
    expect(sculpt.touchedCells).toBeGreaterThan(0)

    const paint = parseTextContent(
      await client.callTool({
        name: 'brush_stroke',
        arguments: {
          tool: 'biome',
          biome: 'MagicForest',
          points: [{ x: portPos.x, y: portPos.y }],
          radius: 35,
        },
      }),
    )
    expect(paint.ok).toBe(true)
    expect(paint.changed).toBe(true)

    // 4. Add/update kingdom and paint territory
    const newK = parseTextContent(
      await client.callTool({
        name: 'manage_kingdoms',
        arguments: { action: 'add', name: 'Liga dos Corsários', color: '#2f7f74' },
      }),
    )
    expect(newK.kingdom.name).toBe('Liga dos Corsários')
    const kPaint = parseTextContent(
      await client.callTool({
        name: 'brush_stroke',
        arguments: {
          tool: 'kingdom',
          kingdomId: newK.kingdom.id,
          points: [{ x: portPos.x, y: portPos.y }],
          radius: 45,
        },
      }),
    )
    expect(kPaint.ok).toBe(true)

    // 5. Manage markers (including linking a capital to the new kingdom) & labels
    const markers = parseTextContent(
      await client.callTool({
        name: 'manage_markers',
        arguments: {
          operations: [
            {
              action: 'add',
              kind: 'port',
              x: portPos.x,
              y: portPos.y,
              name: 'Porto da Bruma',
              notes: 'Mercado de especiarias e guilda de navegadores.',
              capitalOfKingdomId: newK.kingdom.id,
            },
            { action: 'add', kind: 'dungeon', x: 500, y: 310, name: 'Abismo Antigo' },
          ],
        },
      }),
    )
    expect(markers.results).toHaveLength(2)
    const portId = markers.results[0].id
    const dungeonId = markers.results[1].id

    // Verify capital linked via manage_markers, then unlink & re-link via manage_kingdoms
    expect(session.world?.states.find((s) => s.id === newK.kingdom.id)?.capital).toBe(portId)
    const unlinked = parseTextContent(
      await client.callTool({ name: 'manage_kingdoms', arguments: { action: 'update', id: newK.kingdom.id, capitalId: null } }),
    )
    expect(unlinked.kingdom.capital).toBeNull()
    const relinked = parseTextContent(
      await client.callTool({ name: 'manage_kingdoms', arguments: { action: 'update', id: newK.kingdom.id, capitalId: portId } }),
    )
    expect(relinked.kingdom.capital).toBe(portId)

    const markerUpdate = parseTextContent(
      await client.callTool({
        name: 'manage_markers',
        arguments: {
          operations: [
            { action: 'update', id: portId, notes: 'Atualizado com gancho de campanha.' },
            { action: 'remove', id: dungeonId },
          ],
        },
      }),
    )
    expect(markerUpdate.results.every((r: { ok: boolean }) => r.ok)).toBe(true)

    const labels = parseTextContent(
      await client.callTool({
        name: 'manage_labels',
        arguments: {
          operations: [{ action: 'add', x: 180, y: 120, text: 'Mar das Brumas', size: 28, rotation: -12 }],
        },
      }),
    )
    expect(labels.results[0].ok).toBe(true)

    // 6. Update settings & test compact undo/redo
    const settingsRes = parseTextContent(
      await client.callTool({ name: 'update_settings', arguments: { gridType: 'square', gridKm: 100 } }),
    )
    expect(settingsRes.settings.gridType).toBe('square')

    const undoneRaw = await client.callTool({ name: 'undo_redo', arguments: { action: 'undo' } })
    const undoneText = (undoneRaw.content as { type: string; text?: string }[])[0].text!
    expect(undoneText.length).toBeLessThan(600) // compact payload, not full map dump
    const undone = JSON.parse(undoneText)
    expect(undone.changed).toBe(true)
    expect(undone.settings.gridType).toBe('hex')
    expect(undone.counts.kingdoms).toBe(4)

    const redone = parseTextContent(await client.callTool({ name: 'undo_redo', arguments: { action: 'redo' } }))
    expect(redone.changed).toBe(true)
    expect(redone.settings.gridType).toBe('square')

    // 7. Render preview (inline PNG + SVG export)
    const previewRes = await client.callTool({
      name: 'render_preview',
      arguments: { maxWidth: 512, outputPath: 'preview.svg', layers: { tint: true } },
    })
    const previewContent = previewRes.content as { type: string; data?: string; mimeType?: string; text?: string }[]
    const imgBlock = previewContent.find((c) => c.type === 'image')
    expect(imgBlock?.mimeType).toBe('image/png')
    expect(imgBlock?.data && Buffer.from(imgBlock.data, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47')
    const svgOnDisk = await readFile(path.join(dir, 'preview.svg'), 'utf8')
    expect(svgOnDisk).toContain('<svg ')
    expect(svgOnDisk).toContain('Porto da Bruma')

    // 8. Save JSON and verify round-trip compatibility with app's parseWorld + load_world
    const saved = parseTextContent(await client.callTool({ name: 'save_world', arguments: { filePath: 'aethel.json' } }))
    expect(saved.ok).toBe(true)
    const rawJson = await readFile(path.join(dir, 'aethel.json'), 'utf8')
    const parsed = parseWorld(rawJson)
    expect(parsed.settings.title).toBe('Terras de Aethel')
    expect(parsed.markers.some((m) => m.name === 'Porto da Bruma')).toBe(true)
    expect(session.filePath).toBe(path.join(dir, 'aethel.json'))

    // Load into a fresh MCP server instance
    const { client: client2 } = await setupClient(dir)
    const loaded = parseTextContent(await client2.callTool({ name: 'load_world', arguments: { filePath: 'aethel.json' } }))
    expect(loaded.ok).toBe(true)
    expect(loaded.summary.settings.title).toBe('Terras de Aethel')
    expect(loaded.summary.markers.items.some((m: { name: string }) => m.name === 'Porto da Bruma')).toBe(true)

    // 9. Regenerate kingdoms preserves hand-made markers
    const regen = parseTextContent(
      await client2.callTool({ name: 'regenerate_kingdoms', arguments: { count: 2, variant: 1 } }),
    )
    expect(regen.ok).toBe(true)
    expect(regen.kingdoms.length).toBeGreaterThan(0)

    // 10. Start/status/stop live-preview bridge tool
    const liveOff = parseTextContent(await client.callTool({ name: 'live_preview', arguments: { action: 'status' } }))
    expect(liveOff.running).toBe(false)
    const liveOn = parseTextContent(await client.callTool({ name: 'live_preview', arguments: { action: 'start', port: 0 } }))
    expect(liveOn.running).toBe(true)
    expect(liveOn.connectUrl).toContain('?mcp=')
    const liveStopped = parseTextContent(await client.callTool({ name: 'live_preview', arguments: { action: 'stop' } }))
    expect(liveStopped.running).toBe(false)
    expect(liveBridge.running).toBe(false)
  })
})
