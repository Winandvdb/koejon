import { rngNext } from '../engine'
import { SOLO_CODE } from './link-local'

/**
 * `?seed=N`: a solo game that repeats exactly (deal, bot names, bot plays), so a
 * scripted demo can film the same game every run.
 *
 * Never in a live build: whoever knows the seed knows every hand. It works in the
 * Vite dev server, and in a build made with VITE_ALLOW_SEED=1 (a local review
 * build). The deploy workflows do not set that flag, so Vite folds SEED_ALLOWED to
 * false there and the parameter is ignored.
 */
export const SEED_ALLOWED: boolean = import.meta.env.DEV || import.meta.env.VITE_ALLOW_SEED === '1'

/** The seed in `search` (a location.search string), or null when absent, invalid or not allowed. */
export function demoSeed(search: string, allowed: boolean): number | null {
  if (!allowed) return null
  const v = new URLSearchParams(search).get('seed')
  return v !== null && /^\d{1,9}$/.test(v) ? Number(v) : null
}

/** The host's random source for room `code`: seeded only for the solo room.
 *  A seeded multiplayer host would know every player's hand. */
export function hostRand(seed: number | null, code: string): (() => number) | undefined {
  return seed !== null && code === SOLO_CODE ? seededRandom(seed) : undefined
}

/** The engine's mulberry32 (rngNext) with the Math.random signature. */
export function seededRandom(seed: number): () => number {
  const holder = { rng: seed | 0 }
  return () => rngNext(holder)
}
