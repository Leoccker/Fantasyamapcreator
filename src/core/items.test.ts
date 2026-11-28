import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { ICON_LIMITS } from './icons'
import { addIcon, addLabel, addMarker, addState, hitTest, itemExists, markerKindName, moveItem, patchItem, removeIcon, removeItem } from './items'

const w = generate({ seed: 'itens', width: 800, height: 500, continents: 2, waterPct: 50, cellCount: 2000, kingdoms: 3 })

describe('itens', () => {
  it('adicionar, mover, editar e remover nunca mexem no mundo original', () => {
    const before = structuredClone({ markers: w.markers, labels: w.labels, states: w.states })
    const [a, sel] = addMarker(w, 'dungeon', 50, 60)
    const b = moveItem(a, sel, 70, 80)
    const c = patchItem(b, sel, { name: 'Cripta', notes: 'Cuidado' })
    removeItem(c, sel)
    expect({ markers: w.markers, labels: w.labels, states: w.states }).toEqual(before)
    expect(c.markers.find((m) => m.id === sel.id)).toMatchObject({ x: 70, y: 80, name: 'Cripta', notes: 'Cuidado' })
  })

  it('edição sem mudança devolve o mesmo mundo (não cria passo no histórico)', () => {
    const m = w.markers[0]
    expect(patchItem(w, { type: 'marker', id: m.id }, { name: m.name })).toBe(w)
  })

  it('editar ou mover um item gerado tira o "auto"', () => {
    const m = w.markers[0]
    expect(m.auto).toBe(true)
    const moved = moveItem(w, { type: 'marker', id: m.id }, m.x + 5, m.y)
    expect(moved.markers.find((x) => x.id === m.id)!.auto).toBeUndefined()
  })

  it('ids nunca são reaproveitados', () => {
    const [a, s1] = addLabel(w, 100, 100)
    const [b, s2] = addLabel(removeItem(a, s1), 120, 100)
    expect(s2.id).not.toBe(s1.id)
    expect(itemExists(b, s1)).toBe(false)
  })

  it('remover a capital deixa o reino sem capital; patchItem pode vincular ou desvincular capital', () => {
    const st = w.states[0]
    const out = removeItem(w, { type: 'marker', id: st.capital! })
    expect(out.states.find((s) => s.id === st.id)!.capital).toBeNull()

    const [withCap, capSel] = addMarker(out, 'capital', 200, 200)
    const linked = patchItem(withCap, { type: 'state', id: st.id }, { capital: capSel.id })
    expect(linked.states.find((s) => s.id === st.id)!.capital).toBe(capSel.id)
    expect(patchItem(linked, { type: 'state', id: st.id }, { capital: 999999 })).toBe(linked) // unknown marker ignored
    const unlinked = patchItem(linked, { type: 'state', id: st.id }, { capital: null })
    expect(unlinked.states.find((s) => s.id === st.id)!.capital).toBeNull()
  })

  it('posição fica dentro do mapa e tamanho/rotação ficam nos limites', () => {
    const [a, sel] = addLabel(w, 10, 10)
    const out = patchItem(moveItem(a, sel, -50, 9999), sel, { size: 9999, rotation: 270 })
    expect(out.labels.find((l) => l.id === sel.id)).toMatchObject({ x: 0, y: w.height, size: 200, rotation: -90 })
  })

  it('reinos não são apagados; um reino novo ganha id e cor próprios', () => {
    const st = w.states[0]
    expect(removeItem(w, { type: 'state', id: st.id })).toBe(w)
    const [out, sel] = addState(w)
    expect(sel.id).toBe(Math.max(...w.states.map((s) => s.id)) + 1)
    expect(w.states.map((s) => s.color)).not.toContain(out.states.at(-1)!.color)
  })

  it('clique acha marcador, depois rótulo girado, depois o reino', () => {
    const m = w.markers[0]
    expect(hitTest(w, m.x + 1, m.y, 0)).toEqual({ type: 'marker', id: m.id })
    const [a, sel] = addLabel(w, 400, 250)
    const b = patchItem(a, sel, { text: 'Montanhas Altas', rotation: 90, size: 20 })
    expect(hitTest(b, 400, 250 + 60, 0)).toEqual(sel) // along the rotated text
    expect(hitTest(b, 400 + 60, 250, 0)).not.toEqual(sel) // beside it
  })
})

describe('ícones de marcador', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

  it('tipos de povoado ganham nome gerado; os outros, o nome do tipo', () => {
    const [a, s1] = addMarker(w, 'capital', 100, 100)
    const [b, s2] = addMarker(a, 'volcano', 120, 100)
    expect(b.markers.find((m) => m.id === s1.id)!.name).not.toBe('Capital')
    expect(b.markers.find((m) => m.id === s2.id)!.name).toBe('Vulcão')
  })

  it('enviar, usar e excluir um ícone; os marcadores voltam ao ícone do tipo', () => {
    const [a, id] = addIcon(w, 'Brasão.png', PNG)!
    const [b, sel] = addMarker(a, 'castle', 100, 100, id)
    expect(markerKindName(b, b.markers.at(-1)!)).toBe('Brasão.png')
    const c = removeIcon(b, id)
    expect(c.icons).toEqual([])
    expect(c.markers.find((m) => m.id === sel.id)).not.toHaveProperty('icon')
    expect(markerKindName(c, c.markers.at(-1)!)).toBe('Castelo')
  })

  it('trocar para o ícone do tipo tira o ícone enviado; sem ícone, é uma edição vazia', () => {
    const [a, id] = addIcon(w, 'Brasão', PNG)!
    const [b, sel] = addMarker(a, 'castle', 100, 100, id)
    const c = patchItem(b, sel, { kind: 'castle', icon: 0 })
    expect(c.markers.at(-1)).not.toHaveProperty('icon')
    expect(patchItem(c, sel, { kind: 'castle', icon: 0 })).toBe(c)
    expect(patchItem(c, sel, { icon: 999 })).toBe(c) // icon that doesn't exist: ignored
  })

  it('recusa imagem que não poderia ser salva, e para no limite de ícones', () => {
    expect(addIcon(w, 'x', 'data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    let full = w
    for (let k = 0; k < ICON_LIMITS.count; k++) full = addIcon(full, `i${k}`, PNG)![0]
    expect(addIcon(full, 'mais um', PNG)).toBeNull()
  })
})
