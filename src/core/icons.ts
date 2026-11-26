// Marker icons: the built-in catalog (names, groups, shapes) and the rules for user-uploaded icons.
// One source for the canvas, the icon picker and the SVG export. Pure: shapes are SVG path data.

/** How a shape's style letters paint, in drawing order. */
export const SHAPE_PAINTS = [
  ['P', 'fill', 'paper'],
  ['I', 'fill', 'ink'],
  ['W', 'stroke', 'paper'],
  ['S', 'stroke', 'ink'],
] as const

/** Stroke width of a shape without its own, in map units. */
export const DEFAULT_SHAPE_W = 1.2

/**
 * One stroke/fill of an icon, in a box from -1 to 1 (drawn MARKER_SIZE map units across).
 * Style letters (see SHAPE_PAINTS for the order): P = paper fill, I = ink fill, W = paper stroke (a halo that
 * keeps line icons readable over the map), S = ink stroke. `w` is the stroke width in map units (default DEFAULT_SHAPE_W).
 */
export type IconShape = readonly [d: string, style: string, w?: number]

interface IconDef {
  name: string
  shapes: readonly IconShape[]
  /** The bigger marker name, for the main settlements. */
  big?: true
  italic?: true
  /** A new marker of this kind gets a generated place name instead of the kind's name. */
  named?: true
}

const n = (v: number) => +v.toFixed(3)
const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`
const star = (points: number, outer: number, inner: number, cy = 0) =>
  Array.from({ length: points * 2 }, (_, k) => {
    const a = (k * Math.PI) / points - Math.PI / 2
    const r = k % 2 ? inner : outer
    return `${k ? 'L' : 'M'}${n(Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`
  }).join('') + 'Z'
/** Ink lines over a paper halo. */
const lines = (d: string, w = DEFAULT_SHAPE_W): IconShape[] => [[d, 'W', w + 1.4], [d, 'S', w]]
const stones = Array.from({ length: 6 }, (_, k) => {
  const a = (k * Math.PI) / 3
  return `M${n(Math.cos(a) * 0.62 - 0.12)} ${n(Math.sin(a) * 0.62 - 0.2)}h.24v.4h-.24Z`
}).join('')

export const ICONS = {
  capital: { name: 'Capital', big: true, named: true, shapes: [[circle(0, 0, 0.85), 'PS'], [star(5, 0.6, 0.25, 0.05), 'I']] },
  city: { name: 'Cidade', big: true, named: true, shapes: [[circle(0, 0, 0.8), 'PS'], [circle(0, 0, 0.35), 'I']] },
  town: { name: 'Vila', named: true, shapes: [[circle(0, 0, 0.45), 'IW', 1.5]] },
  village: { name: 'Aldeia', named: true, shapes: [['M-.6 .6V-.1L0 -.65L.6 -.1V.6Z', 'PS'], ['M-.15 .6V.2H.15V.6Z', 'I']] },
  port: {
    name: 'Porto',
    named: true,
    shapes: [...lines('M0 -.38V.75M-.38 -.12H.38M-.7 .2Q-.6 .78 0 .75Q.6 .78 .7 .2'), [circle(0, -0.58, 0.2), 'PS']],
  },
  farm: { name: 'Fazenda', shapes: [['M-.75 -.45H.75V.6H-.75Z', 'PS'], ['M-.75 -.1H.75M-.75 .25H.75M0 -.45V.6', 'S', 0.8]] },
  tavern: {
    name: 'Taverna',
    shapes: [...lines('M.3 -.2H.62V.35H.3'), ['M-.5 -.45H.3V.7H-.5Z', 'PS'], ['M-.6 -.4Q-.4 -.8 -.1 -.55Q.15 -.85 .4 -.4Z', 'PS']],
  },

  castle: { name: 'Castelo', shapes: [['M-.8 .7V-.6H-.5V-.3H-.15V-.6H.15V-.3H.5V-.6H.8V.7Z', 'PS'], ['M-.25 .7V.25A.25 .25 0 0 1 .25 .25V.7Z', 'I']] },
  tower: {
    name: 'Torre',
    shapes: [['M-.38 .85V-.45H-.5V-.85H-.25V-.65H-.08V-.85H.08V-.65H.25V-.85H.5V-.45H.38V.85Z', 'PS'], ['M-.09 -.2H.09V.15H-.09Z', 'I']],
  },
  fort: {
    name: 'Forte',
    shapes: [['M-.6 -.6H.6V.6H-.6Z', 'PS'], ['M-.88 -.88h.42v.42h-.42ZM.46 -.88h.42v.42h-.42ZM-.88 .46h.42v.42h-.42ZM.46 .46h.42v.42h-.42Z', 'PS'], ['M-.2 -.2H.2V.2H-.2Z', 'I']],
  },
  watchtower: {
    name: 'Torre de vigia',
    shapes: [...lines('M-.32 0L-.55 .85M.32 0L.55 .85M-.45 .45H.45'), ['M-.4 -.35H.4V0H-.4Z', 'PS'], ['M-.6 -.35L0 -.85L.6 -.35Z', 'PS']],
  },
  bridge: { name: 'Ponte', shapes: [...lines('M-.9 -.2V-.5M.9 -.2V-.5M-.9 -.5H.9', 1), ['M-.9 -.2H.9V.6H.6V.5A.6 .5 0 0 0 -.6 .5V.6H-.9Z', 'PS']] },
  gate: { name: 'Portão', shapes: [['M-.8 .7V-.65H-.4V-.35H.4V-.65H.8V.7H.3V.2A.3 .3 0 0 0 -.3 .2V.7Z', 'PS'], ['M-.15 .2V.7M0 .1V.7M.15 .2V.7', 'S', 0.6]] },

  temple: {
    name: 'Templo',
    shapes: [['M-.85 -.35L0 -.85L.85 -.35Z', 'PS'], ...lines('M-.55 -.35V.55M-.18 -.35V.55M.18 -.35V.55M.55 -.35V.55'), ['M-.85 .55H.85V.78H-.85Z', 'PS']],
  },
  shrine: { name: 'Santuário', shapes: [['M-.5 .75V-.1A.5 .5 0 0 1 .5 -.1V.75Z', 'PS'], ['M0 .45Q-.25 .15 0 -.25Q.25 .15 0 .45Z', 'I']] },
  wizard_tower: {
    name: 'Torre de mago',
    shapes: [['M-.32 .85V-.2H.32V.85Z', 'PS'], ['M-.48 -.2L0 -.95L.48 -.2Z', 'IS'], [star(4, 0.17, 0.06, 0.25), 'I']],
  },
  portal: {
    name: 'Portal',
    shapes: [['M0 -.85A.52 .85 0 1 0 0 .85A.52 .85 0 1 0 0 -.85Z', 'IS'], ['M0 -.55A.28 .55 0 1 0 0 .55A.28 .55 0 1 0 0 -.55Z', 'P']],
  },
  stones: { name: 'Círculo de pedras', shapes: [[stones, 'PS', 1], [circle(0, 0, 0.12), 'I']] },
  sacred_tree: { name: 'Árvore sagrada', shapes: [['M-.12 .85V.2H.12V.85Z', 'I'], [circle(0, -0.2, 0.62), 'PS'], [star(4, 0.3, 0.1, -0.2), 'I']] },

  dungeon: {
    name: 'Masmorra',
    italic: true,
    shapes: [['M-.7 .7V-.05A.7 .7 0 0 1 .7 -.05V.7Z', 'PS'], ['M-.35 .7V.05A.35 .35 0 0 1 .35 .05V.7Z', 'I']],
  },
  cave: { name: 'Caverna', italic: true, shapes: [['M-.9 .6Q-.6 -.75 0 -.75Q.6 -.75 .9 .6Z', 'PS'], ['M-.4 .6Q-.35 0 0 0Q.35 0 .4 .6Z', 'I']] },
  dragon_lair: {
    name: 'Covil de dragão',
    shapes: [
      ['M0 .45L-.95 -.6Q-.65 -.35 -.5 -.1Q-.42 -.45 -.18 -.42Q-.2 -.05 0 .08Q.2 -.05 .18 -.42Q.42 -.45 .5 -.1Q.65 -.35 .95 -.6Z', 'PS'],
      ['M0 .85Q-.3 .5 0 .05Q.3 .5 0 .85Z', 'I'],
    ],
  },
  mine: { name: 'Mina', shapes: lines('M-.6 .75L.45 -.55M.6 .75L-.45 -.55M.1 -.8Q.6 -.65 .8 -.15M-.1 -.8Q-.6 -.65 -.8 -.15', 1.3) },
  camp: { name: 'Acampamento', shapes: [['M-.85 .7L0 -.75L.85 .7Z', 'PS'], ['M-.25 .7L0 .1L.25 .7Z', 'I']] },
  graveyard: {
    name: 'Cemitério',
    shapes: [['M-.8 .78Q0 .2 .8 .78Z', 'PS'], ['M-.1 .45V-.35H-.42V-.55H-.1V-.85H.1V-.55H.42V-.35H.1V.45Z', 'PS', 1]],
  },
  volcano: {
    name: 'Vulcão',
    shapes: [...lines('M0 -.55Q-.3 -.7 -.05 -.85Q.2 -.95 .05 -1', 0.9), ['M-.9 .7L-.25 -.4H.25L.9 .7Z', 'PS'], ['M-.25 -.4L-.1 .05L.03 -.2L.14 .1L.25 -.4Z', 'I']],
  },
  shipwreck: {
    name: 'Naufrágio',
    italic: true,
    shapes: [
      ...lines('M-.1 .25L.2 -.85M-.95 .9Q-.75 .72 -.5 .9Q-.25 1.05 0 .9'),
      ['M.16 -.65L.65 -.38L.06 -.22Z', 'PS', 1],
      ['M-.85 .1L.75 .42L.55 .72L-.65 .52Z', 'PS'],
    ],
  },
  ruin: {
    name: 'Ruína',
    italic: true,
    shapes: [['M-.45 -.6H.45V.7H-.45Z', 'P'], ['M-.45 .7V-.4L-.1 -.7L.2 -.35L.45 -.55V.7Z', 'S'], ['M0 -.3V.7', 'S']],
  },
  poi: { name: 'Ponto de interesse', shapes: [['M0 -.8L.6 0L0 .8L-.6 0Z', 'PS'], [circle(0, 0, 0.15), 'I']] },
} satisfies Record<string, IconDef>

export type MarkerKind = keyof typeof ICONS
export const MARKER_KINDS = Object.keys(ICONS) as MarkerKind[]
/** The catalog entry, typed so optional flags (big, italic, named) can be read on any kind. */
export const iconDef = (kind: MarkerKind): IconDef => ICONS[kind]

/** Picker order. Every kind is in exactly one group. */
export const ICON_GROUPS: { name: string; kinds: MarkerKind[] }[] = [
  { name: 'Povoados', kinds: ['capital', 'city', 'town', 'village', 'port', 'farm', 'tavern'] },
  { name: 'Fortificações', kinds: ['castle', 'tower', 'fort', 'watchtower', 'bridge', 'gate'] },
  { name: 'Sagrado e magia', kinds: ['temple', 'shrine', 'wizard_tower', 'portal', 'stones', 'sacred_tree'] },
  { name: 'Perigos e masmorras', kinds: ['dungeon', 'cave', 'dragon_lair', 'mine', 'camp', 'graveyard', 'volcano', 'shipwreck', 'ruin'] },
  { name: 'Outros', kinds: ['poi'] },
]

/** An uploaded image, saved in the map as a small PNG/WebP data URL. */
export interface CustomIcon {
  id: number
  name: string
  src: string
}

/** Upload size on the map, in pixels per side. */
export const ICON_PX = 64
/** Caps for untrusted files: they bound what the autosave stores (a 64 px PNG is a few KB). */
export const ICON_LIMITS = { count: 32, src: 40_000 } as const

/**
 * Only base64 PNG or WebP (checked by their magic bytes). This is what keeps an imported file from putting an
 * SVG, a script URL or an outside link into an <img> or into the SVG export.
 */
export const isIconSrc = (s: unknown): s is string =>
  typeof s === 'string' && s.length <= ICON_LIMITS.src && /^data:image\/(png;base64,iVBORw0KGgo|webp;base64,UklGR)[A-Za-z0-9+/]*={0,2}$/.test(s)
