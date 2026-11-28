# Fantasy Map Creator — Servidor MCP

Servidor **MCP (Model Context Protocol)** via `stdio` que permite a IAs gerar, inspecionar geograficamente, esculpir, popular com reinos/marcadores/lore, renderizar prévias (PNG/SVG), sincronizar ao vivo com o navegador e salvar mapas `.json` 100% compatíveis com o editor web do Fantasy Map Creator.

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
        "MAP_MCP_WORKDIR": "/caminho/opcional/para/pasta-dos-mapas",
        "MAP_MCP_LIVE_PORT": "4175"
      }
    }
  }
}
```

> - `MAP_MCP_WORKDIR` é opcional. Quando definido, todos os caminhos relativos de `load_world`, `save_world` e `render_preview` são resolvidos dentro dessa pasta e caminhos fora dela são bloqueados.
> - `MAP_MCP_LIVE_PORT` é opcional. Quando definido, o servidor já inicia o bridge local de **Live-Preview** (`127.0.0.1`) ao subir. Você também pode iniciar/parar sob demanda pela ferramenta `live_preview`.
> - `MAP_MCP_LIVE_TOKEN` e `MAP_MCP_APP_URL` (padrão `http://localhost:5173`) também são opcionais.

## Live-Preview no Navegador (tempo real bidirecional)

1. Inicie o editor web em um terminal:
   ```bash
   npm run dev
   ```
2. Peça à IA para chamar `live_preview` com `{ "action": "start" }` (ou configure `MAP_MCP_LIVE_PORT=4175`).
3. Abra o `connectUrl` retornado pela IA (ex.: `http://localhost:5173/?mcp=http%3A%2F%2F127.0.0.1%3A4175&token=...`) — ou clique no botão **MCP** na barra superior do editor e cole a URL + token.
4. Acompanhe a IA gerando, esculpindo e posicionando lugares ao vivo (com pulso visual no ponto editado e opção de seguir com a câmera), pause a sincronização quando quiser editar manualmente e retome para a IA continuar sobre a sua edição. `Ctrl+Z` no navegador também desfaz edições recebidas da IA.

## Ferramentas disponíveis (15)

- **Ciclo de vida:** `generate_world`, `load_world`, `save_world`, `undo_redo`
- **Consulta geográfica:** `inspect_world`, `sample_point`, `find_locations`
- **Escultura e reinos:** `brush_stroke`, `regenerate_kingdoms`, `manage_kingdoms`
- **Lugares e configurações:** `manage_markers`, `manage_labels`, `update_settings`
- **Visualização e tempo real:** `render_preview` (PNG inline / exporta `.png` ou `.svg`), `live_preview` (inicia/para o canal local de sincronização com o navegador)

## Exemplo de prompt para a IA

> "Ative o `live_preview` e me passe o link para eu acompanhar no navegador. Depois crie um mapa médio chamado *Arquipélago de Solis* com 3 continentes, 65% de água e 4 reinos. Encontre uma boa baía costeira para fundar um porto comercial, uma montanha alta para um covil de dragão e uma fronteira entre dois reinos para um forte — preenchendo as notas de cada marcador com ganchos de RPG. Salve em `solis.json`."
