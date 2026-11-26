// Fantasy names from syllables, pure and seeded: the same rng gives the same names.

export type NameKind = 'state' | 'city' | 'sea'

const ONSETS = ['', 'b', 'br', 'c', 'd', 'dr', 'f', 'g', 'gr', 'l', 'm', 'n', 'p', 'r', 's', 'st', 't', 'th', 'v', 'z', 'qu', 'ch']
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ae', 'ia', 'ei', 'au']
const CODAS = ['', '', '', 'n', 'r', 'l', 's', 'm', 'th', 'nd']
const STATE_SUFFIX = ['ia', 'or', 'andia', 'ar', 'ena', 'oria', 'eth', 'ádia']
const CITY_SUFFIX = ['', '', '', 'dor', 'vale', 'mar', 'burgo', 'heim']
const SEA_PREFIX = ['Mar de', 'Golfo de', 'Baía de', 'Mar de']
const MAX_TRIES = 40

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/**
 * Returns a function that makes names of a kind, never repeating one it gave or one in `taken`
 * (case-insensitive). After MAX_TRIES clashes it appends a numeral, so it never loops forever.
 */
export function makeNamer(rng: () => number, taken: Iterable<string> = []): (kind: NameKind) => string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)]
  const word = (syllables: number) => {
    let w = ''
    for (let k = 0; k < syllables; k++) w += pick(ONSETS) + pick(VOWELS) + (k === syllables - 1 ? pick(CODAS) : '')
    return w.charAt(0).toUpperCase() + w.slice(1)
  }
  const make = (kind: NameKind) => {
    if (kind === 'state') return word(2) + pick(STATE_SUFFIX)
    if (kind === 'sea') return `${pick(SEA_PREFIX)} ${word(2)}`
    return word(2 + Math.floor(rng() * 2)) + pick(CITY_SUFFIX)
  }
  return (kind) => {
    let name = make(kind)
    for (let t = 0; used.has(name.toLowerCase()) && t < MAX_TRIES; t++) name = make(kind)
    for (let k = 0; used.has(name.toLowerCase()); k++) name = `${name.replace(/ [IVX]+$/, '')} ${ROMAN[k] ?? k + 2}`
    used.add(name.toLowerCase())
    return name
  }
}
