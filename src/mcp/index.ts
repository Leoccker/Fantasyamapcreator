#!/usr/bin/env node
// Stdio entrypoint for the Fantasy Map Creator MCP server.
// IMPORTANT: stdout is reserved for JSON-RPC protocol frames; all diagnostic logs must go to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMapMcpServer } from './server'

async function main() {
  const { server } = createMapMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[fantasy-map-creator-mcp] pronto (stdio)')
}

main().catch((err) => {
  console.error('[fantasy-map-creator-mcp] erro fatal:', err)
  process.exit(1)
})
