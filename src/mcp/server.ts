// MCP server definition: registers all map creation, spatial query, editing, and rendering tools.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Biome, LAND_BIOMES } from '../core/biomes'
import { commitSession, startSession, strokeTo, type Brush, type BrushTool } from '../core/brush'
import { DEFAULTS, generate } from '../core/generate'
import { MARKER_KINDS, type MarkerKind } from '../core/icons'
import { addLabel, addMarker, addState, patchItem, removeItem, type Patch, type Sel } from '../core/items'
import { generateKingdoms } from '../core/kingdoms'
import type { LiveHighlight } from '../core/liveProtocol'
import { RADIUS_MIN, radiusDefault, radiusMax, SIZES, sizeById } from '../core/mapSize'
import { CORNERS, GRID_TYPES, patchSettings, SETTINGS_LIMITS } from '../core/settings'
import { LIMITS, parseWorld, serializeWorld, TEXT_LIMITS, type World } from '../core/world'
import { DEFAULT_LAYERS, LAYERS, type LayerId, type Layers } from '../render/draw'
import { LiveBridge } from './liveBridge'
import { renderWorldPng, renderWorldSvg } from './renderHeadless'
import { MapSession, resolveSafePath } from './session'
import {
  BIOME_KEYS,
  compactWorldCounts,
  findLocations,
  inspectWorld,
  LAND_BIOME_KEYS,
  parseBiome,
  parseLandBiome,
  samplePoint,
  type Quadrant,
  type TerrainFilter,
} from './spatial'

export interface CreateServerOptions {
  session?: MapSession
  liveBridge?: LiveBridge
  /** Optional directory jail for load/save/export paths (defaults to process.env.MAP_MCP_WORKDIR). */
  workdir?: string
}

const SIZE_IDS = SIZES.map((s) => s.id) as ['small', 'medium', 'large', 'huge']
const TERRAIN_FILTERS = ['any', 'land', 'water', 'ocean', 'lake', 'coast', 'mountain', 'lowland', 'river', 'river_mouth'] as const satisfies readonly TerrainFilter[]
const QUADRANTS = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e', 'center'] as const satisfies readonly Quadrant[]
const BRUSH_TOOLS = ['raise', 'lower', 'smooth', 'biome', 'kingdom'] as const satisfies readonly BrushTool[]
const LAYER_IDS = Object.keys(LAYERS) as LayerId[]

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  }
}

async function writeFileEnsuringDir(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp` // concurrent saves to one path must not share a temp file
  await writeFile(tmpPath, data)
  await rename(tmpPath, filePath)
}

type BatchOpResult = { action: string; id?: number; ok: boolean; error?: string }

function runItemBatch<
  TItem extends { id: number; x: number; y: number },
  TOp extends { action: 'add' } | { action: 'update'; id: number } | { action: 'remove'; id: number },
>(
  session: MapSession,
  operations: TOp[],
  cfg: {
    reason: string
    type: 'marker' | 'label'
    notFound: string
    list: (w: World) => TItem[]
    label: (item: TItem) => string
    add: (w: World, op: Extract<TOp, { action: 'add' }>) => { world: World; id: number } | { error: string }
    updatePatch: (op: Extract<TOp, { action: 'update' }>) => Patch
  },
) {
  const results: BatchOpResult[] = []
  const highlights: LiveHighlight[] = []
  const { world, changed } = session.edit(
    (startWorld) => {
      let w = startWorld
      for (const op of operations) {
        if (op.action === 'add') {
          const added = cfg.add(w, op as Extract<TOp, { action: 'add' }>)
          if ('error' in added) {
            results.push({ action: 'add', ok: false, error: added.error })
            continue
          }
          w = added.world
          const created = cfg.list(w).find((it) => it.id === added.id)
          if (created) highlights.push({ kind: 'point', x: created.x, y: created.y, label: cfg.label(created) })
          results.push({ action: 'add', id: added.id, ok: true })
        } else {
          if (!cfg.list(w).some((it) => it.id === op.id)) {
            results.push({ action: op.action, id: op.id, ok: false, error: cfg.notFound })
            continue
          }
          const sel: Sel = { type: cfg.type, id: op.id }
          if (op.action === 'update') {
            w = patchItem(w, sel, cfg.updatePatch(op as Extract<TOp, { action: 'update' }>))
            const updated = cfg.list(w).find((it) => it.id === op.id)
            if (updated) highlights.push({ kind: 'point', x: updated.x, y: updated.y, label: cfg.label(updated) })
          } else {
            w = removeItem(w, sel)
          }
          results.push({ action: op.action, id: op.id, ok: true })
        }
      }
      return w
    },
    { reason: cfg.reason, highlights },
  )
  return { world, changed, results }
}

export function createMapMcpServer(options: CreateServerOptions = {}): { server: McpServer; session: MapSession; liveBridge: LiveBridge } {
  const session = options.session ?? new MapSession()
  const liveBridge = options.liveBridge ?? new LiveBridge(session)
  const workdir = options.workdir ?? process.env.MAP_MCP_WORKDIR

  const server = new McpServer({
    name: 'fantasy-map-creator',
    version: '0.1.0',
  })

  // 1. generate_world
  server.registerTool(
    'generate_world',
    {
      title: 'Gerar novo mapa',
      description:
        'Gera um novo mapa procedural determinístico na sessão ativa e retorna um resumo compacto. ' +
        `Biomas de terra válidos: ${LAND_BIOME_KEYS.join(', ')}.`,
      inputSchema: {
        seed: z.string().min(1).max(120).optional().describe('Seed determinística do mapa (ex.: "arquipelago-norte").'),
        size: z.enum(SIZE_IDS).optional().describe('Preset de tamanho: small (1000x625), medium (1600x1000), large (2400x1500), huge (3200x2000).'),
        continents: z.number().int().min(LIMITS.continents[0]).max(LIMITS.continents[1]).optional().describe('Quantidade de continentes (1..6).'),
        waterPct: z.number().min(LIMITS.waterPct[0]).max(LIMITS.waterPct[1]).optional().describe('Porcentagem aproximada de água (5..95).'),
        kingdoms: z.number().int().min(LIMITS.kingdoms[0]).max(LIMITS.kingdoms[1]).optional().describe('Quantidade de reinos iniciais (0..12).'),
        biomes: z.array(z.string()).optional().describe(`Subconjunto de biomas de terra permitidos: ${LAND_BIOME_KEYS.join(', ')}.`),
        title: z.string().max(SETTINGS_LIMITS.title).optional().describe('Título opcional exibido na moldura do mapa.'),
      },
    },
    async (args) => {
      const preset = sizeById(args.size ?? 'medium')
      let biomes = [...LAND_BIOMES]
      if (args.biomes?.length) {
        biomes = args.biomes.map((b) => {
          const parsed = parseLandBiome(b)
          if (parsed === null) throw new Error(`Bioma de terra inválido: "${b}". Válidos: ${LAND_BIOME_KEYS.join(', ')}.`)
          return parsed
        })
      }
      const seed = args.seed ?? `map-${Math.random().toString(36).slice(2, 10)}`
      let world = generate({
        seed,
        width: preset.width,
        height: preset.height,
        cellCount: preset.cells,
        continents: args.continents ?? DEFAULTS.continents,
        waterPct: args.waterPct ?? DEFAULTS.waterPct,
        kingdoms: args.kingdoms ?? DEFAULTS.kingdoms,
        biomes,
      })
      if (args.title) world = patchSettings(world, { title: args.title })
      session.setWorld(world, null, { reason: 'generate_world' })
      return jsonResult({ ok: true, summary: inspectWorld(world) })
    },
  )

  // 2. load_world
  server.registerTool(
    'load_world',
    {
      title: 'Carregar mapa JSON',
      description: 'Carrega e valida um arquivo .json salvo pelo Fantasy Map Creator na sessão ativa.',
      inputSchema: {
        filePath: z.string().min(1).describe('Caminho do arquivo .json do mapa.'),
      },
    },
    async ({ filePath }) => {
      const resolved = resolveSafePath(filePath, workdir)
      const raw = await readFile(resolved, 'utf8')
      const world = parseWorld(raw)
      session.setWorld(world, resolved, { reason: 'load_world' })
      return jsonResult({ ok: true, filePath: resolved, summary: inspectWorld(world) })
    },
  )

  // 3. save_world
  server.registerTool(
    'save_world',
    {
      title: 'Salvar mapa JSON',
      description: 'Salva o mapa ativo em formato .json 100% compatível com o editor web do Fantasy Map Creator.',
      inputSchema: {
        filePath: z.string().min(1).optional().describe('Caminho de destino .json (opcional se o mapa já tiver um caminho associado).'),
      },
    },
    async ({ filePath }) => {
      const world = session.requireWorld()
      const target = filePath ? resolveSafePath(filePath, workdir) : session.filePath
      if (!target) throw new Error('Informe `filePath` para salvar um mapa novo.')
      const json = serializeWorld(world)
      await writeFileEnsuringDir(target, json)
      session.setFilePath(target)
      return jsonResult({ ok: true, filePath: target, bytes: Buffer.byteLength(json, 'utf8') })
    },
  )

  // 4. undo_redo
  server.registerTool(
    'undo_redo',
    {
      title: 'Desfazer ou refazer edição',
      description: 'Desfaz (undo) ou refaz (redo) a última alteração no mapa ativo, retornando um resumo compacto dos contadores.',
      inputSchema: {
        action: z.enum(['undo', 'redo']).describe('Ação a executar.'),
      },
    },
    async ({ action }) => {
      const res = action === 'undo' ? session.undo() : session.redo()
      return jsonResult({
        ok: true,
        action,
        changed: res.changed,
        status: session.status(),
        counts: compactWorldCounts(res.world),
        settings: res.world.settings,
      })
    },
  )

  // 5. inspect_world
  server.registerTool(
    'inspect_world',
    {
      title: 'Inspecionar mapa',
      description:
        'Retorna um resumo estruturado e leve do mapa ativo: dimensões, distribuição de biomas, reinos (área, centro, fronteiras, acesso ao mar), principais rios, marcadores e rótulos.',
      inputSchema: {},
    },
    async () => {
      const world = session.requireWorld()
      return jsonResult({ status: session.status(), summary: inspectWorld(world) })
    },
  )

  // 6. sample_point
  server.registerTool(
    'sample_point',
    {
      title: 'Consultar ponto (x, y)',
      description: 'Inspeciona o terreno, bioma, altitude, costa, rio, reino e marcadores próximos de uma coordenada (x, y).',
      inputSchema: {
        x: z.number().describe('Coordenada X em unidades do mapa (0..width).'),
        y: z.number().describe('Coordenada Y em unidades do mapa (0..height).'),
      },
    },
    async ({ x, y }) => {
      const world = session.requireWorld()
      return jsonResult(samplePoint(world, x, y))
    },
  )

  // 7. find_locations
  server.registerTool(
    'find_locations',
    {
      title: 'Buscar coordenadas geográficas',
      description:
        'Encontra coordenadas bem distribuídas no mapa que satisfaçam critérios geográficos (ex.: costa de um reino, picos de montanha, foz de rio, fronteira entre dois reinos, áreas livres de outros marcadores). ' +
        'Use sempre esta ferramenta antes de posicionar cidades, portos, fortalezas ou masmorras para garantir coerência geográfica.',
      inputSchema: {
        terrain: z.enum(TERRAIN_FILTERS).optional().describe('Filtro de terreno (padrão: "land").'),
        biome: z.string().optional().describe(`Filtro de bioma específico (${BIOME_KEYS.join(', ')}).`),
        kingdomId: z.number().int().min(0).optional().describe('ID do reino (0 = terras sem reino).'),
        borderOfKingdoms: z
          .tuple([z.number().int().min(1), z.number().int().min(1)])
          .optional()
          .describe('Par [idA, idB] para encontrar pontos na fronteira entre dois reinos.'),
        quadrant: z.enum(QUADRANTS).optional().describe('Região do mapa: nw, ne, sw, se, n, s, w, e, center.'),
        bounds: z
          .object({ minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number() })
          .optional()
          .describe('Retângulo delimitador opcional em unidades do mapa.'),
        minDistanceFromMarkers: z.number().min(0).optional().describe('Distância mínima de marcadores já existentes.'),
        minSpacing: z.number().min(0).optional().describe('Distância mínima entre os pontos retornados.'),
        avoidOverlays: z.boolean().optional().describe('Evita áreas cobertas pela bússola e barra de escala (padrão: true).'),
        limit: z.number().int().min(1).max(20).optional().describe('Quantidade máxima de locais sugeridos (padrão: 5).'),
      },
    },
    async (args) => {
      const world = session.requireWorld()
      let biome: Biome | undefined
      if (args.biome) {
        const parsed = parseBiome(args.biome)
        if (parsed === null) throw new Error(`Bioma inválido: "${args.biome}". Válidos: ${BIOME_KEYS.join(', ')}.`)
        biome = parsed
      }
      const result = findLocations(world, {
        terrain: args.terrain,
        biome,
        kingdomId: args.kingdomId,
        borderOfKingdoms: args.borderOfKingdoms,
        quadrant: args.quadrant,
        bounds: args.bounds,
        minDistanceFromMarkers: args.minDistanceFromMarkers,
        minSpacing: args.minSpacing,
        avoidOverlays: args.avoidOverlays,
        limit: args.limit,
      })
      return jsonResult(result)
    },
  )

  // 8. brush_stroke
  server.registerTool(
    'brush_stroke',
    {
      title: 'Aplicar traço de pincel',
      description:
        'Esculpe terreno (raise, lower, smooth), pinta biomas (biome) ou pinta/encolhe territórios de reinos (kingdom) ao longo de um ou mais pontos (x, y). ' +
        'Para criar ilhas/montanhas use `raise`; para canais/mares use `lower`; para suavizar costas use `smooth`.',
      inputSchema: {
        tool: z.enum(BRUSH_TOOLS).describe('Ferramenta de pincel.'),
        points: z
          .array(z.object({ x: z.number(), y: z.number() }))
          .min(1)
          .max(200)
          .describe('Sequência de pontos do traço em coordenadas do mapa.'),
        radius: z.number().min(RADIUS_MIN).optional().describe('Raio do pincel em unidades do mapa.'),
        strength: z.number().min(0.05).max(1).optional().describe('Força do pincel (0.05..1, padrão: 0.6).'),
        passes: z.number().int().min(1).max(10).optional().describe('Repetições do traço para levantar montanhas/escavar mais fundo (padrão: 1).'),
        biome: z.string().optional().describe(`Obrigatório para tool="biome". Biomas de terra: ${LAND_BIOME_KEYS.join(', ')}.`),
        kingdomId: z.number().int().min(0).optional().describe('Obrigatório para tool="kingdom" (0 apaga território).'),
        shrink: z.boolean().optional().describe('Apenas para tool="kingdom": true remove células da borda desse reino.'),
      },
    },
    async (args) => {
      const current = session.requireWorld()
      const radius = Math.min(radiusMax(current), Math.max(RADIUS_MIN, args.radius ?? radiusDefault(current)))
      const strength = args.strength ?? 0.6
      const passes = args.passes ?? 1

      let biome: Biome = Biome.Forest
      if (args.tool === 'biome') {
        if (!args.biome) throw new Error('Informe `biome` quando tool="biome".')
        const parsed = parseLandBiome(args.biome)
        if (parsed === null) throw new Error(`Bioma de terra inválido: "${args.biome}". Válidos: ${LAND_BIOME_KEYS.join(', ')}.`)
        biome = parsed
      }

      let state = 0
      if (args.tool === 'kingdom') {
        if (args.kingdomId === undefined) throw new Error('Informe `kingdomId` quando tool="kingdom" (0 apaga território).')
        if (args.kingdomId !== 0 && !current.states.some((s) => s.id === args.kingdomId)) {
          throw new Error(`Reino id=${args.kingdomId} não existe. Use \`manage_kingdoms\` ou \`inspect_world\`.`)
        }
        state = args.kingdomId
      }

      const brush: Brush = { radius, strength, biome, state, marker: 'city' }
      const strokeLabel =
        args.tool === 'biome'
          ? args.biome
          : args.tool === 'kingdom'
            ? current.states.find((st) => st.id === state)?.name ?? (state === 0 ? 'apagar reino' : `reino ${state}`)
            : args.tool
      let touchedCount = 0
      const { world, changed } = session.edit(
        (w) => {
          const s = startSession(w, args.tool, Boolean(args.shrink))
          for (let p = 0; p < passes; p++) {
            s.last = null
            for (const pt of args.points) strokeTo(s, pt.x, pt.y, brush)
          }
          touchedCount = s.touched.size
          return commitSession(s) ?? w
        },
        {
          reason: 'brush_stroke',
          highlights: [{ kind: 'stroke', points: args.points, radius, label: strokeLabel }],
        },
      )

      return jsonResult({
        ok: true,
        changed,
        touchedCells: touchedCount,
        meta: inspectWorld(world).meta,
      })
    },
  )

  // 9. regenerate_kingdoms
  server.registerTool(
    'regenerate_kingdoms',
    {
      title: 'Regerar reinos',
      description: 'Regera reinos, capitais e vilas automaticamente no terreno atual, preservando marcadores e rótulos criados manualmente.',
      inputSchema: {
        count: z.number().int().min(LIMITS.kingdoms[0]).max(LIMITS.kingdoms[1]).describe('Quantidade de reinos (0..12).'),
        variant: z.number().int().min(0).optional().describe('Número de variação para gerar outra distribuição mantendo o mesmo terreno.'),
      },
    },
    async ({ count, variant }) => {
      const editMeta: { reason: string; highlights?: LiveHighlight[] } = { reason: 'regenerate_kingdoms' }
      const { world } = session.edit((w) => {
        const next = generateKingdoms(w, count, variant ?? 0)
        const caps: LiveHighlight[] = next.states
          .map((st) => {
            const cap = st.capital !== null ? next.markers.find((m) => m.id === st.capital) : undefined
            return cap ? ({ kind: 'point', x: cap.x, y: cap.y, label: st.name } as LiveHighlight) : null
          })
          .filter((h): h is LiveHighlight => h !== null)
        if (caps.length) editMeta.highlights = caps
        return next
      }, editMeta)
      return jsonResult({ ok: true, kingdoms: inspectWorld(world).kingdoms })
    },
  )

  // 10. manage_markers
  server.registerTool(
    'manage_markers',
    {
      title: 'Gerenciar marcadores',
      description:
        'Adiciona, atualiza ou remove marcadores no mapa (suporta lote via `operations`). ' +
        `Tipos válidos (kind): ${MARKER_KINDS.join(', ')}.`,
      inputSchema: {
        operations: z
          .array(
            z.discriminatedUnion('action', [
              z.object({
                action: z.literal('add'),
                kind: z.enum(MARKER_KINDS as [MarkerKind, ...MarkerKind[]]).describe('Tipo do ícone do marcador.'),
                x: z.number(),
                y: z.number(),
                name: z.string().max(TEXT_LIMITS.name).optional().describe('Nome do local (se omitido, gera automaticamente).'),
                notes: z.string().max(TEXT_LIMITS.notes).optional().describe('Notas/lore de RPG sobre o local.'),
                capitalOfKingdomId: z
                  .number()
                  .int()
                  .min(1)
                  .optional()
                  .describe('Opcional: vincula este novo marcador como capital do reino informado.'),
              }),
              z.object({
                action: z.literal('update'),
                id: z.number().int().min(1),
                kind: z.enum(MARKER_KINDS as [MarkerKind, ...MarkerKind[]]).optional(),
                x: z.number().optional(),
                y: z.number().optional(),
                name: z.string().max(TEXT_LIMITS.name).optional(),
                notes: z.string().max(TEXT_LIMITS.notes).optional(),
              }),
              z.object({
                action: z.literal('remove'),
                id: z.number().int().min(1),
              }),
            ]),
          )
          .min(1)
          .max(100),
      },
    },
    async ({ operations }) => {
      const { world, changed, results } = runItemBatch(session, operations, {
        reason: 'manage_markers',
        type: 'marker',
        notFound: 'Marcador não encontrado.',
        list: (w) => w.markers,
        label: (m) => m.name,
        add: (w, op) => {
          if (op.capitalOfKingdomId !== undefined && !w.states.some((s) => s.id === op.capitalOfKingdomId)) {
            return { error: `Reino id=${op.capitalOfKingdomId} não encontrado para vincular capital.` }
          }
          let [next, sel] = addMarker(w, op.kind, op.x, op.y)
          if (op.name !== undefined || op.notes !== undefined) {
            next = patchItem(next, sel, { name: op.name, notes: op.notes })
          }
          if (op.capitalOfKingdomId !== undefined) {
            next = patchItem(next, { type: 'state', id: op.capitalOfKingdomId }, { capital: sel.id })
          }
          return { world: next, id: sel.id }
        },
        updatePatch: (op) => ({ kind: op.kind, x: op.x, y: op.y, name: op.name, notes: op.notes }),
      })
      return jsonResult({ ok: true, changed, results, totalMarkers: world.markers.length })
    },
  )

  // 11. manage_labels
  server.registerTool(
    'manage_labels',
    {
      title: 'Gerenciar rótulos',
      description: 'Adiciona, atualiza ou remove rótulos de texto livre no mapa (nomes de oceanos, cordilheiras, regiões, reinos).',
      inputSchema: {
        operations: z
          .array(
            z.discriminatedUnion('action', [
              z.object({
                action: z.literal('add'),
                x: z.number(),
                y: z.number(),
                text: z.string().min(1).max(TEXT_LIMITS.label).optional(),
                size: z.number().min(TEXT_LIMITS.labelSize[0]).max(TEXT_LIMITS.labelSize[1]).optional(),
                rotation: z.number().min(-180).max(180).optional(),
              }),
              z.object({
                action: z.literal('update'),
                id: z.number().int().min(1),
                x: z.number().optional(),
                y: z.number().optional(),
                text: z.string().min(1).max(TEXT_LIMITS.label).optional(),
                size: z.number().min(TEXT_LIMITS.labelSize[0]).max(TEXT_LIMITS.labelSize[1]).optional(),
                rotation: z.number().min(-180).max(180).optional(),
              }),
              z.object({
                action: z.literal('remove'),
                id: z.number().int().min(1),
              }),
            ]),
          )
          .min(1)
          .max(100),
      },
    },
    async ({ operations }) => {
      const { world, changed, results } = runItemBatch(session, operations, {
        reason: 'manage_labels',
        type: 'label',
        notFound: 'Rótulo não encontrado.',
        list: (w) => w.labels,
        label: (l) => l.text,
        add: (w, op) => {
          let [next, sel] = addLabel(w, op.x, op.y)
          if (op.text !== undefined || op.size !== undefined || op.rotation !== undefined) {
            next = patchItem(next, sel, { text: op.text, size: op.size, rotation: op.rotation })
          }
          return { world: next, id: sel.id }
        },
        updatePatch: (op) => ({ x: op.x, y: op.y, text: op.text, size: op.size, rotation: op.rotation }),
      })
      return jsonResult({ ok: true, changed, results, totalLabels: world.labels.length })
    },
  )

  // 12. manage_kingdoms
  server.registerTool(
    'manage_kingdoms',
    {
      title: 'Gerenciar reinos',
      description:
        'Cria um novo reino vazio (para pintar depois com `brush_stroke` tool="kingdom") ou atualiza nome, cor (#rrggbb) e capital (`capitalId`, ID de um marcador existente ou null para desvincular).',
      inputSchema: {
        action: z.enum(['add', 'update']),
        id: z.number().int().min(1).optional().describe('ID do reino (obrigatório quando action="update").'),
        name: z.string().min(1).max(TEXT_LIMITS.name).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve estar no formato hexadecimal #rrggbb.')
          .optional(),
        capitalId: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe('ID do marcador a definir como capital do reino (ou null para deixar sem capital).'),
      },
    },
    async (args) => {
      let targetId = args.id ?? 0
      const editMeta: { reason: string; highlights?: LiveHighlight[] } = { reason: 'manage_kingdoms' }
      const { world, changed } = session.edit((w) => {
        if (args.capitalId !== undefined && args.capitalId !== null && !w.markers.some((m) => m.id === args.capitalId)) {
          throw new Error(`Marcador id=${args.capitalId} não encontrado para definir como capital.`)
        }
        let next: World
        if (args.action === 'add') {
          const [added, sel] = addState(w)
          targetId = sel.id
          next =
            args.name || args.color || args.capitalId !== undefined
              ? patchItem(added, sel, { name: args.name, color: args.color, capital: args.capitalId })
              : added
        } else {
          if (!args.id) throw new Error('Informe `id` quando action="update".')
          if (!w.states.some((s) => s.id === args.id)) throw new Error(`Reino id=${args.id} não encontrado.`)
          next = patchItem(w, { type: 'state', id: args.id }, { name: args.name, color: args.color, capital: args.capitalId })
        }
        const st = next.states.find((s) => s.id === targetId)
        const cap = st?.capital != null ? next.markers.find((m) => m.id === st.capital) : undefined
        if (st && cap) {
          editMeta.highlights = [{ kind: 'point', x: cap.x, y: cap.y, label: st.name }]
        }
        return next
      }, editMeta)
      const state = world.states.find((s) => s.id === targetId)
      return jsonResult({ ok: true, changed, kingdom: state ?? null })
    },
  )

  // 13. update_settings
  server.registerTool(
    'update_settings',
    {
      title: 'Atualizar configurações do mapa',
      description: 'Altera título na moldura, tipo e tamanho da grade (hex/square), escala em km/unidade e posição da bússola e barra de escala.',
      inputSchema: {
        title: z.string().max(SETTINGS_LIMITS.title).optional(),
        gridType: z.enum(GRID_TYPES).optional(),
        gridKm: z.number().min(SETTINGS_LIMITS.gridKm[0]).max(SETTINGS_LIMITS.gridKm[1]).optional(),
        kmPerUnit: z.number().min(SETTINGS_LIMITS.kmPerUnit[0]).max(SETTINGS_LIMITS.kmPerUnit[1]).optional(),
        scaleCorner: z.enum(CORNERS).optional(),
        compassCorner: z.enum(CORNERS).optional(),
      },
    },
    async (args) => {
      const { world, changed } = session.edit((w) => patchSettings(w, args), { reason: 'update_settings' })
      return jsonResult({ ok: true, changed, settings: world.settings })
    },
  )

  // 14. render_preview
  const layersShape = Object.fromEntries(LAYER_IDS.map((id) => [id, z.boolean().optional()])) as Record<LayerId, z.ZodOptional<z.ZodBoolean>>
  server.registerTool(
    'render_preview',
    {
      title: 'Renderizar prévia visual (PNG / SVG)',
      description:
        'Renderiza o mapa atual para visualização direta (retorna imagem PNG para você inspecionar o layout, sobreposições e estética) ' +
        'e opcionalmente exporta o arquivo PNG ou SVG em disco.',
      inputSchema: {
        layers: z.object(layersShape).optional().describe(`Camadas opcionais para ligar/desligar (padrão: ${JSON.stringify(DEFAULT_LAYERS)}).`),
        maxWidth: z.number().int().min(256).max(4096).optional().describe('Largura máxima do PNG em pixels (padrão: 1024).'),
        outputPath: z.string().min(1).optional().describe('Caminho opcional para salvar a imagem (.png ou .svg).'),
        returnImage: z.boolean().optional().describe('Se true (padrão), inclui a imagem PNG na resposta para inspeção visual.'),
      },
    },
    async (args) => {
      const world = session.requireWorld()
      const layers = args.layers as Partial<Layers> | undefined
      const returnImage = args.returnImage ?? true
      let savedPath: string | null = null
      let savedFormat: 'svg' | 'png' | null = null
      let pngResult: { png: Buffer; width: number; height: number } | null = null

      if (args.outputPath) {
        savedPath = resolveSafePath(args.outputPath, workdir)
        if (savedPath.toLowerCase().endsWith('.svg')) {
          const svg = renderWorldSvg(world, { layers, maxWidth: args.maxWidth })
          await writeFileEnsuringDir(savedPath, svg)
          savedFormat = 'svg'
        } else {
          pngResult = renderWorldPng(world, { layers, maxWidth: args.maxWidth })
          await writeFileEnsuringDir(savedPath, pngResult.png)
          savedFormat = 'png'
        }
      }

      if (returnImage && !pngResult) {
        pngResult = renderWorldPng(world, { layers, maxWidth: args.maxWidth })
      }

      const content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      )[] = [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              width: pngResult?.width ?? world.width,
              height: pngResult?.height ?? world.height,
              savedPath,
              savedFormat,
            },
            null,
            2,
          ),
        },
      ]

      if (returnImage && pngResult) {
        content.push({
          type: 'image',
          data: pngResult.png.toString('base64'),
          mimeType: 'image/png',
        })
      }

      return { content }
    },
  )

  // 15. live_preview
  server.registerTool(
    'live_preview',
    {
      title: 'Controlar live-preview no navegador',
      description:
        'Inicia, para ou consulta o servidor local de live-preview (127.0.0.1) para sincronização bidirecional em tempo real com o editor web no navegador. ' +
        'Quando iniciado, retorna `connectUrl` pronto para o usuário abrir no navegador e acompanhar/editar o mapa ao vivo.',
      inputSchema: {
        action: z.enum(['start', 'stop', 'status']).describe('Ação no canal de live-preview.'),
        port: z.number().int().min(0).max(65535).optional().describe('Porta local opcional em 127.0.0.1 (padrão: 4175; 0 escolhe porta livre).'),
        appUrl: z.string().url().optional().describe('URL do editor web (padrão: http://localhost:5173).'),
      },
    },
    async ({ action, port, appUrl }) => {
      if (action === 'start') {
        const status = await liveBridge.start({
          port,
          appUrl,
          token: process.env.MAP_MCP_LIVE_TOKEN,
        })
        return jsonResult({ ok: true, ...status })
      }
      if (action === 'stop') {
        await liveBridge.stop()
        return jsonResult({ ok: true, ...liveBridge.status() })
      }
      return jsonResult({ ok: true, ...liveBridge.status() })
    },
  )

  return { server, session, liveBridge }
}
