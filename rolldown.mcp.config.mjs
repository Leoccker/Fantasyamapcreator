export default {
  input: 'src/mcp/index.ts',
  platform: 'node',
  external: [/^node:/, /^@modelcontextprotocol\//, '@resvg/resvg-js', 'zod', 'd3-delaunay', 'simplex-noise'],
  output: {
    file: 'dist-mcp/index.js',
    format: 'esm',
  },
}
