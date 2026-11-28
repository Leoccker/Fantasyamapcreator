#!/usr/bin/env node
// Stdio entrypoint for the Fantasy Map Creator MCP server.
// IMPORTANT: stdout is reserved for JSON-RPC protocol frames; all diagnostic logs must go to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMapMcpServer } from './server'

async function main() {
  const { server, liveBridge } = createMapMcpServer()

  const envPort = process.env.MAP_MCP_LIVE_PORT
  if (envPort !== undefined && envPort.trim() !== '') {
    const parsed = Number(envPort)
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
      const status = await liveBridge.start({
        port: parsed,
        token: process.env.MAP_MCP_LIVE_TOKEN,
        appUrl: process.env.MAP_MCP_APP_URL,
      })
      console.error(`[fantasy-map-creator-mcp] live-preview ativo em ${status.url}`)
      console.error(`[fantasy-map-creator-mcp] abra no navegador: ${status.connectUrl}`)
    } else {
      console.error(`[fantasy-map-creator-mcp] MAP_MCP_LIVE_PORT inválido ("${envPort}"); esperado inteiro entre 0 e 65535.`)
    }
  }

  const shutdown = () => {
    void liveBridge.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[fantasy-map-creator-mcp] pronto (stdio)')
}

main().catch((err) => {
  console.error('[fantasy-map-creator-mcp] erro fatal:', err)
  process.exit(1)
})
