import { matchScore } from '../engine'
import type { PublicState } from '../engine'
import type { KeyValueStore } from './link-local'

/** Personal statistics of the player on this device. Team values count for both players. */
export interface PlayerStats {
  played: number
  won: number
  score: number
  doubles: number
  triples: number
  bidsMade: number
  bidsWon: number
}

interface Saved extends PlayerStats {
  /** The last counted match: a reload on the end screen must not count it again. */
  last?: string
}

const KEY = 'koejon-stats'

const EMPTY: PlayerStats = { played: 0, won: 0, score: 0, doubles: 0, triples: 0, bidsMade: 0, bidsWon: 0 }

// Default storage is looked up inside try: a blocked localStorage throws on access.
function read(storage?: KeyValueStore): Saved {
  try {
    const json = (storage ?? localStorage).getItem(KEY)
    return { ...EMPTY, ...(json ? (JSON.parse(json) as Partial<Saved>) : {}) }
  } catch {
    return { ...EMPTY }
  }
}

export function loadStats(storage?: KeyValueStore): PlayerStats {
  const { last: _, ...stats } = read(storage)
  return stats
}

/** A finished match's log ends with its last cards, so the room code plus a
 *  hash of the log tells matches apart without an extra match id. */
export function matchKey(code: string, pub: PublicState): string {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(pub.log)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  return `${code}:${(h >>> 0).toString(36)}`
}

/** Adds the numbers of `seat` from a finished match, once per match.
 *  Returns true when it counted. */
export function recordMatch(code: string, pub: PublicState, seat: number, storage?: KeyValueStore): boolean {
  // A host on an older build (prod and dev share one database) sends no stats.
  if (pub.phase !== 'GAME_OVER' || pub.winner === null || !pub.stats) return false
  const s = read(storage)
  const key = matchKey(code, pub)
  if (s.last === key) return false
  const team = seat % 2
  const next: Saved = {
    played: s.played + 1,
    won: s.won + (pub.winner === team ? 1 : 0),
    score: s.score + matchScore(pub, team),
    doubles: s.doubles + pub.stats.doubles[team],
    triples: s.triples + pub.stats.triples[team],
    bidsMade: s.bidsMade + pub.stats.bidsMade[seat],
    bidsWon: s.bidsWon + pub.stats.bidsWon[seat],
    last: key,
  }
  try {
    ;(storage ?? localStorage).setItem(KEY, JSON.stringify(next))
  } catch {
    return false
  }
  // Ask once, at the first counted match, that the browser keeps the data.
  if (next.played === 1) (globalThis.navigator as Navigator | undefined)?.storage?.persist?.().catch(() => {})
  return true
}
