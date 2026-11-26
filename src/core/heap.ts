/** Binary min-heap of cell indices; ties broken by index so the result is deterministic. */
export class MinHeap {
  private ids: number[] = []
  private keys: number[] = []
  get size() {
    return this.ids.length
  }
  push(id: number, key: number) {
    this.ids.push(id)
    this.keys.push(key)
    this.up(this.ids.length - 1)
  }
  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop()!
    const lastKey = this.keys.pop()!
    if (this.ids.length) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      this.down(0)
    }
    return top
  }
  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.ids[a] < this.ids[b])
  }
  private swap(a: number, b: number) {
    ;[this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  private down(i: number) {
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < this.ids.length && this.less(l, m)) m = l
      if (r < this.ids.length && this.less(r, m)) m = r
      if (m === i) return
      this.swap(i, m)
      i = m
    }
  }
}
