import { writable } from 'svelte/store'
import { START_LINES } from '../engine'
import { safeStorage } from './storage'

/** Bot speed factor: divides every host pause; 'instant' removes them. */
export type BotSpeed = 1 | 2 | 5 | 'instant'
export const BOT_SPEEDS: BotSpeed[] = [1, 2, 5, 'instant']

/** Test shortcuts for dev builds. Only the host's values count: it runs the
 *  engine and the bots. A production build always uses DEV_DEFAULTS. */
export interface DevSettings {
  /** Start lines per team, 1..13. Applies from the next match. */
  treeLength: number
  speed: BotSpeed
  /** The host confirms "Gezien" for human seats too. */
  skipSeen: boolean
  /** Off: the host does the dealer draw and the cut for human seats. */
  interactiveDraws: boolean
  /** A bot also plays the host's own seat and starts each next hand. */
  autoplay: boolean
}

export const DEV_DEFAULTS: DevSettings = {
  treeLength: START_LINES,
  speed: 1,
  skipSeen: false,
  interactiveDraws: true,
  autoplay: false,
}

const KEY = 'koejon-dev'

/** A stored value, with every unknown or out-of-range field at its default. */
export function parseDev(json: string | null): DevSettings {
  let v: Partial<DevSettings> = {}
  try {
    v = (JSON.parse(json ?? '{}') as Partial<DevSettings>) ?? {}
  } catch {
    // Broken value: defaults.
  }
  const len = Number(v.treeLength)
  return {
    treeLength: Number.isInteger(len) && len >= 1 && len <= START_LINES ? len : START_LINES,
    speed: BOT_SPEEDS.includes(v.speed as BotSpeed) ? (v.speed as BotSpeed) : 1,
    skipSeen: v.skipSeen === true,
    interactiveDraws: v.interactiveDraws !== false,
    autoplay: v.autoplay === true,
  }
}

/** Per browser, like the other preferences. */
export const devSettings = writable<DevSettings>(parseDev(safeStorage.getItem(KEY)))

/** Change one or more settings; only a change writes storage, so a production
 *  build never stores anything. */
export function setDev(patch: Partial<DevSettings>): void {
  devSettings.update((v) => {
    const next = { ...v, ...patch }
    safeStorage.setItem(KEY, JSON.stringify(next))
    return next
  })
}
