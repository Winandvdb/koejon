import { writable } from 'svelte/store'

/** Display preferences — the card table keeps some info optional, like a real game. */
export interface Settings {
  /** Trump suit, level, multiplier and playing team on the table. */
  info: boolean
  /** Running points and trick counts. */
  score: boolean
  /** Review of the first two tricks while the third has not started. */
  lastTricks: boolean
}

const DEFAULTS: Settings = { info: true, score: false, lastTricks: true }
const KEY = 'koejon-settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<Settings>
    return {
      info: p.info ?? DEFAULTS.info,
      score: p.score ?? DEFAULTS.score,
      lastTricks: p.lastTricks ?? DEFAULTS.lastTricks,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = writable<Settings>(load())

settings.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private mode etc.: preferences just won't persist.
  }
})
