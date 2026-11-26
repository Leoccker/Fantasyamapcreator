// Pure geometry: turns loose coast edge segments into smooth polylines. No DOM.

export interface Polyline {
  /** Flat x,y points. */
  pts: number[]
  closed: boolean
}

/** Chains x1,y1,x2,y2 segments that share endpoints into polylines (closed loops where possible). */
export function chainEdges(edges: Float32Array): Polyline[] {
  const m = edges.length / 4
  const at = new Map<string, number[]>()
  const key = (x: number, y: number) => x + ',' + y
  for (let e = 0; e < m; e++) {
    for (const end of [0, 2]) {
      const k = key(edges[4 * e + end], edges[4 * e + end + 1])
      const list = at.get(k)
      if (list) list.push(e)
      else at.set(k, [e])
    }
  }
  const used = new Uint8Array(m)
  const lines: Polyline[] = []
  for (let s = 0; s < m; s++) {
    if (used[s]) continue
    used[s] = 1
    const sx = edges[4 * s]
    const sy = edges[4 * s + 1]
    const pts = [sx, sy]
    let x = edges[4 * s + 2]
    let y = edges[4 * s + 3]
    for (;;) {
      pts.push(x, y)
      const next = at.get(key(x, y))?.find((e) => !used[e])
      if (next === undefined) break
      used[next] = 1
      const flip = edges[4 * next] === x && edges[4 * next + 1] === y
      x = flip ? edges[4 * next + 2] : edges[4 * next]
      y = flip ? edges[4 * next + 3] : edges[4 * next + 1]
    }
    const closed = pts.length > 4 && pts[pts.length - 2] === sx && pts[pts.length - 1] === sy
    if (closed) pts.length -= 2 // drop the repeated start point
    lines.push({ pts, closed })
  }
  return lines
}

/** Chaikin corner cutting. Open lines keep their endpoints. */
export function smooth(line: Polyline, iterations = 2): Polyline {
  let p = line.pts
  for (let it = 0; it < iterations; it++) {
    const n = p.length / 2
    if (n < 3) break
    const out: number[] = []
    const segs = line.closed ? n : n - 1
    if (!line.closed) out.push(p[0], p[1])
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      const [ax, ay, bx, by] = [p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]]
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by)
    }
    if (!line.closed) out.push(p[p.length - 2], p[p.length - 1])
    p = out
  }
  return { pts: p, closed: line.closed }
}
