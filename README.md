# Fantasy Map Creator

Editor web para criar mapas de fantasia no estilo pergaminho: tinta marrom sobre papel bege, biomas em aquarela, montanhas e florestas desenhadas, rios, reinos com fronteiras tracejadas, cidades e rótulos.

## Funcionalidades

- **Geração procedural** de continentes e ilhas (malha de Voronoi + ruído), com tamanho do mapa, quantidade de água e semente configuráveis.
- **Pincéis** para esculpir terreno e pintar biomas.
- **Reinos** gerados automaticamente ou editados à mão, com cores e fronteiras.
- **Lugares**: marcadores (cidades, castelos, masmorras…), ícones próprios e rótulos com notas.
- **Camadas** liga/desliga, grade, escala, rosa dos ventos e moldura.
- **Importar SVG** como contorno da terra.
- **Exportar** em PNG, SVG ou `.json` (reabre no editor); salvamento automático no navegador.
- **Desfazer/refazer** (`Ctrl+Z` / `Ctrl+Shift+Z` ou `Ctrl+Y`).
- **Servidor MCP** para IAs criarem e editarem mapas, com sincronização ao vivo no navegador — veja [src/mcp/README.md](src/mcp/README.md).

## Como rodar

Requer Node.js 20+.

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Vite) |
| `npm run build` | Verifica tipos e gera a versão de produção em `dist/` |
| `npm run preview` | Serve o build de produção localmente |
| `npm test` | Roda os testes (Vitest) |
| `npm run typecheck` | Só a verificação de tipos |
| `npm run mcp:build` | Gera o servidor MCP em `dist-mcp/` |
| `npm run mcp:start` | Inicia o servidor MCP |

## Estrutura

```
src/
  core/        geração do mundo, biomas, reinos, pincéis, histórico (sem DOM)
  render/      desenho em canvas, exportação SVG/PNG, vista e zoom
  components/  interface React (painéis, barra superior, gestos)
  mcp/         servidor MCP e ponte de live-preview
```

## Tecnologias

React 19, TypeScript, Vite, Canvas 2D, d3-delaunay, simplex-noise, Model Context Protocol SDK.
