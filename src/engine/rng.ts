/** Advance the mulberry32 state kept in `holder.rng` and return a float in [0, 1). */
export function rngNext(holder: { rng: number }): number {
  holder.rng |= 0
  holder.rng = (holder.rng + 0x6d2b79f5) | 0
  let t = Math.imul(holder.rng ^ (holder.rng >>> 15), 1 | holder.rng)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Uniform integer in [0, n). */
export function rngInt(holder: { rng: number }, n: number): number {
  return Math.floor(rngNext(holder) * n)
}

/** Uniform integer in [lo, hi] inclusive. */
export function rngRange(holder: { rng: number }, lo: number, hi: number): number {
  return lo + rngInt(holder, hi - lo + 1)
}

/** In-place Fisher-Yates shuffle. */
export function rngShuffle<T>(holder: { rng: number }, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(holder, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}
