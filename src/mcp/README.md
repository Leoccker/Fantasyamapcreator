# Fantasy Map Creator — Servidor MCP

Servidor **MCP (Model Context Protocol)** via `stdio` que permite a IAs gerar, inspecionar geograficamente, esculpir, popular com reinos/marcadores/lore, renderizar prévias (PNG/SVG) e salvar mapas `.json` 100% compatíveis com o editor web do Fantasy Map Creator.

## Build

```bash
npm run mcp:build
```

O bundle executável é gerado em `dist-mcp/index.js`.

## Configuração em clientes MCP

Exemplo para **Claude Desktop**, **Cursor**, **Antigravity** ou qualquer cliente MCP `stdio`:

```json
{
  "mcpServers": {
    "fantasy-map-creator": {
      "command": "node",
      "args": ["/caminho/absoluto/para/Fantasyamapcreator/dist-mcp/index.js"],
      "env": {
        "MAP_MCP_WORKDIR": "/caminho/opcional/para/pasta-dos-mapas"
      }
    }
  }
}
```

> `MAP_MCP_WORKDIR` é opcional. Quando definido, todos os caminhos relativos de `load_world`, `save_world` e `render_preview` são resolvidos dentro dessa pasta e caminhos fora dela são bloqueados.

## Ferramentas disponíveis (14)

- **Ciclo de vida:** `generate_world`, `load_world`, `save_world`, `undo_redo`
- **Consulta geográfica:** `inspect_world`, `sample_point`, `find_locations`
- **Escultura e reinos:** `brush_stroke`, `regenerate_kingdoms`, `manage_kingdoms`
- **Lugares e configurações:** `manage_markers`, `manage_labels`, `update_settings`
- **Visualização e exportação:** `render_preview` (retorna PNG inline para modelos multimodais e opcionalmente salva `.png` ou `.svg`)

## Exemplo de prompt para a IA

> "Crie um mapa médio chamado *Arquipélago de Solis* com 3 continentes, 65% de água e 4 reinos. Encontre uma boa baía costeira para fundar um porto comercial, uma montanha alta para um covil de dragão e uma fronteira entre dois reinos para um forte — preenchendo as notas de cada marcador com ganchos de RPG. Renderize uma prévia para conferir o visual e salve em `solis.json`."
