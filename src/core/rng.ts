// Seeded randomness. Nothing in generate/world/mesh may use Math.random or Date.now.

/** xmur3 string hash -> uint32. */
export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** mulberry32 PRNG, returns floats in [0, 1). */
export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One independent stream per generation stage, so adding a stage never changes existing seeds. */
export function rngFor(seed: string, stream: string): () => number {
  return mulberry32(hashSeed(seed + ':' + stream))
}
