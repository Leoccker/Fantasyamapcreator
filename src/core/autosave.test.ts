import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP, clearAutosave, createAutosaver, hasBackup, KEY, loadAutosave, META, saveAutosave, type KV } from './autosave'
import { generate } from './generate'
import { patchSettings } from './settings'
import { serializeWorld, WORLD_VERSION } from './world'

const w = generate({ seed: 'auto', width: 400, height: 300, continents: 2, waterPct: 50, cellCount: 1500, kingdoms: 2 })

function fakeStorage(failOn?: (k: string) => Error | null): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      const e = failOn?.(k)
      if (e) throw e
      data.set(k, v)
    },
    removeItem: (k) => void data.delete(k),
  }
}
const quota = () => Object.assign(new Error('cheio'), { name: 'QuotaExceededError' })

describe('autosave', () => {
  it('salva e restaura o mesmo mapa, com a marca de edição', () => {
    const s = fakeStorage()
    const edited = patchSettings(w, { title: 'Terras do Norte' })
    expect(saveAutosave(s, edited, true, 123)).toEqual({ ok: true })
    expect(loadAutosave(s)).toEqual({ kind: 'ok', world: edited, edited: true, savedAt: 123 })
  })

  it('sem nada salvo: none; sem meta: considera editado (pergunta antes de descartar)', () => {
    const s = fakeStorage()
    expect(loadAutosave(s)).toEqual({ kind: 'none' })
    s.data.set(KEY, serializeWorld(w))
    expect(loadAutosave(s)).toMatchObject({ kind: 'ok', edited: true, savedAt: null })
  })

  it('save corrompido ou de versão mais nova vai para o backup e não é apagado', () => {
    for (const raw of ['{quebrado', serializeWorld(w).replace(`"version":${WORLD_VERSION}`, '"version":99')]) {
      const s = fakeStorage()
      s.data.set(KEY, raw)
      expect(loadAutosave(s)).toMatchObject({ kind: 'bad', backedUp: true })
      expect(s.data.get(BACKUP)).toBe(raw)
      expect(s.data.get(KEY)).toBe(raw)
      expect(loadAutosave(s)).toMatchObject({ kind: 'bad', backedUp: true }) // running twice is the same
    }
  })

  it('se nem o backup puder ser gravado, avisa (backedUp false)', () => {
    const s = fakeStorage((k) => (k === BACKUP ? quota() : null))
    s.data.set(KEY, '{quebrado')
    expect(loadAutosave(s)).toMatchObject({ kind: 'bad', backedUp: false })
  })

  it('armazenamento cheio não quebra nada e mantém o save anterior', () => {
    const s = fakeStorage()
    saveAutosave(s, w, false, 1)
    const before = s.data.get(KEY)
    const full = { ...s, setItem: () => { throw quota() } }
    expect(saveAutosave(full, patchSettings(w, { gridKm: 10 }), true, 2)).toEqual({ ok: false, reason: 'quota' })
    expect(s.data.get(KEY)).toBe(before)
  })

  it('limpar apaga tudo o que foi guardado, inclusive o backup', () => {
    const s = fakeStorage()
    saveAutosave(s, w, false, 1)
    s.data.set(BACKUP, 'x')
    expect(hasBackup(s)).toBe(true)
    clearAutosave(s)
    expect([s.data.has(KEY), s.data.has(META), hasBackup(s)]).toEqual([false, false, false])
  })
})

describe('salvamento automático com espera', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('várias mudanças seguidas viram uma gravação só, 1 s depois da última', () => {
    const s = fakeStorage()
    const spy = vi.spyOn(s, 'setItem')
    const results: unknown[] = []
    const saver = createAutosaver(s, (r) => results.push(r), () => 7, 1000)
    let cur = w
    for (let k = 0; k < 5; k++) {
      cur = patchSettings(cur, { gridKm: 10 + k })
      saver.request(cur, true)
      vi.advanceTimersByTime(500)
    }
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(results).toEqual([{ ok: true }])
    expect(loadAutosave(s)).toMatchObject({ kind: 'ok', world: cur, savedAt: 7 })
  })

  it('flush grava na hora; o mesmo mapa não é regravado; desativado não grava nada', () => {
    const s = fakeStorage()
    const spy = vi.spyOn(s, 'setItem')
    const saver = createAutosaver(s, () => {}, () => 0)
    saver.request(w, false)
    saver.flush()
    expect(spy).toHaveBeenCalledTimes(2) // map + meta
    saver.request(w, false)
    saver.flush()
    expect(spy).toHaveBeenCalledTimes(2)
    saver.disable()
    saver.request(patchSettings(w, { gridKm: 7 }), true)
    saver.flush()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('depois de pausado, limpar volta a salvar', () => {
    const s = fakeStorage()
    const saver = createAutosaver(s, () => {}, () => 0)
    saver.disable()
    saver.request(w, true)
    saver.flush()
    expect(s.data.has(KEY)).toBe(false)
    saver.clear()
    saver.request(w, true)
    saver.flush()
    expect(s.data.has(KEY)).toBe(true)
  })

  it('limpar cancela a gravação pendente', () => {
    const s = fakeStorage()
    const saver = createAutosaver(s, () => {}, () => 0)
    saver.request(w, true)
    saver.clear()
    vi.advanceTimersByTime(2000)
    expect(s.data.has(KEY)).toBe(false)
  })
})
