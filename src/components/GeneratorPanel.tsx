import type { FormEvent } from 'react'
import { BIOME_NAMES, LAND_BIOMES, type LandBiome } from '../core/biomes'
import { LIMITS } from '../core/world'
import { BIOME_COLORS } from '../render/palette'

/** Raw input strings (App clamps them to LIMITS when generating), plus the land biomes generation may use. */
export type GenForm = { seed: string; biomes: LandBiome[] } & Record<keyof typeof LIMITS, string>

interface Props {
  form: GenForm
  onChange(form: GenForm): void
  onGenerate(): void
  onRandomSeed(): void
  /** Re-creates only the kingdoms (and their generated places), keeping relief and hand-made places. */
  onGenerateKingdoms(): void
}

export function GeneratorPanel({ form, onChange, onGenerate, onRandomSeed, onGenerateKingdoms }: Props) {
  const set = (k: Exclude<keyof GenForm, 'biomes'>) => (e: { target: { value: string } }) => onChange({ ...form, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onGenerate()
  }

  return (
    // noValidate: App clamps and rounds the values, so the browser must not block e.g. 8200 cells over step=500.
    <form className="gen-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="seed">Seed</label>
        <span className="row">
          <input id="seed" type="text" value={form.seed} onChange={set('seed')} />
          <button type="button" onClick={onRandomSeed} title="Seed aleatória" aria-label="Seed aleatória">
            🎲
          </button>
        </span>
      </div>
      <label>
        Continentes
        <input type="number" step={1} min={LIMITS.continents[0]} max={LIMITS.continents[1]} value={form.continents} onChange={set('continents')} />
      </label>
      <label>
        <span>Água: {form.waterPct}%</span>
        <input type="range" step={1} min={LIMITS.waterPct[0]} max={LIMITS.waterPct[1]} value={form.waterPct} onChange={set('waterPct')} />
      </label>
      <label>
        Células
        <input type="number" step={500} min={LIMITS.cellCount[0]} max={LIMITS.cellCount[1]} value={form.cellCount} onChange={set('cellCount')} />
      </label>
      <label>
        Reinos
        <input type="number" step={1} min={LIMITS.kingdoms[0]} max={LIMITS.kingdoms[1]} value={form.kingdoms} onChange={set('kingdoms')} />
      </label>
      <fieldset className="biome-set">
        <legend>Biomas que podem aparecer</legend>
        {LAND_BIOMES.map((b) => {
          const on = form.biomes.includes(b)
          return (
            <label key={b} className="check">
              <input
                type="checkbox"
                checked={on}
                disabled={on && form.biomes.length === 1} // at least one land biome stays
                onChange={() => onChange({ ...form, biomes: LAND_BIOMES.filter((x) => (x === b ? !on : form.biomes.includes(x))) })}
              />
              <span className="swatch" style={{ background: BIOME_COLORS[b] }} aria-hidden="true" />
              {BIOME_NAMES[b]}
            </label>
          )
        })}
        <p className="hint">Um bioma desmarcado vira o mais parecido que estiver marcado.</p>
      </fieldset>
      <div className="row">
        <button type="submit">Gerar</button>
        <button type="button" onClick={onGenerateKingdoms} title="Refaz só os reinos, sem mexer no relevo nem no que você colocou à mão">
          Gerar reinos
        </button>
      </div>
    </form>
  )
}
