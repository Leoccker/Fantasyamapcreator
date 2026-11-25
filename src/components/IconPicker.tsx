import { useId } from 'react'
import { DEFAULT_SHAPE_W, ICON_GROUPS, iconDef, SHAPE_PAINTS, type CustomIcon, type MarkerKind } from '../core/icons'
import { MARKER_SIZE } from '../core/items'
import { SHAPE_COLORS } from '../render/palette'

/** A catalog icon as inline SVG, from the same shapes the map draws. */
export function IconGlyph({ kind }: { kind: MarkerKind }) {
  return (
    <svg viewBox="-1.3 -1.3 2.6 2.6" width="24" height="24" aria-hidden="true" strokeLinejoin="round">
      {iconDef(kind).shapes.flatMap(([d, style, w = DEFAULT_SHAPE_W], k) =>
        SHAPE_PAINTS.filter(([letter]) => style.includes(letter)).map(([letter, paint, color]) => (
          <path
            key={`${k}${letter}`}
            d={d}
            fill={paint === 'fill' ? SHAPE_COLORS[color] : 'none'}
            stroke={paint === 'stroke' ? SHAPE_COLORS[color] : undefined}
            strokeWidth={paint === 'stroke' ? w / (MARKER_SIZE / 2) : undefined}
          />
        )),
      )}
    </svg>
  )
}

interface Props {
  label: string
  kind: MarkerKind
  /** Uploaded icon in use, if any. */
  icon?: number
  icons: CustomIcon[]
  onChange(kind: MarkerKind, icon?: number): void
}

/** A grid of marker icons by group, plus the map's uploaded icons. */
export function IconPicker({ label, kind, icon, icons, onChange }: Props) {
  const custom = icons.some((i) => i.id === icon)
  const id = useId()
  return (
    <div className="icon-picker" role="group" aria-label={label}>
      {ICON_GROUPS.map((g, gi) => (
        <div key={g.name} role="group" aria-labelledby={`${id}-g${gi}`}>
          <span className="icon-group" id={`${id}-g${gi}`}>
            {g.name}
          </span>
          <div className="icon-grid">
            {g.kinds.map((k) => (
              <button key={k} type="button" title={iconDef(k).name} aria-label={iconDef(k).name} aria-pressed={!custom && k === kind} onClick={() => onChange(k)}>
                <IconGlyph kind={k} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {icons.length > 0 && (
        <div role="group" aria-labelledby={`${id}-mine`}>
          <span className="icon-group" id={`${id}-mine`}>
            Meus ícones
          </span>
          <div className="icon-grid">
            {icons.map((i) => (
              // The kind stays: it still sets how the marker's name is written.
              <button key={i.id} type="button" title={i.name} aria-label={i.name} aria-pressed={i.id === icon} onClick={() => onChange(kind, i.id)}>
                <img src={i.src} alt="" width={24} height={24} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
