import { matchScore, START_LINES } from '../engine'
import { parseKjn } from './kjn'
import type { KjnMatch } from './kjn'
import type { KeyValueStore } from './link-local'
import { safeStorage } from './storage'

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

/** Totals of the matches that dropped out of the history (`HISTORY_MAX`). */
export const STATS_KEY = 'koejon-stats'

export const EMPTY_STATS: PlayerStats = { played: 0, won: 0, score: 0, doubles: 0, triples: 0, bidsMade: 0, bidsWon: 0 }

const add = (a: PlayerStats, b: PlayerStats): PlayerStats => ({
  played: a.played + b.played,
  won: a.won + b.won,
  score: a.score + b.score,
  doubles: a.doubles + b.doubles,
  triples: a.triples + b.triples,
  bidsMade: a.bidsMade + b.bidsMade,
  bidsWon: a.bidsWon + b.bidsWon,
})

/** The numbers of `seat` in one finished match; an unfinished one counts nothing. */
export function matchStats(m: KjnMatch, seat: number): PlayerStats {
  if (m.winner === null || !m.lines) return { ...EMPTY_STATS }
  const team = seat % 2
  const s: PlayerStats = {
    ...EMPTY_STATS,
    played: 1,
    won: m.winner === team ? 1 : 0,
    score: matchScore({ lines: m.lines, winner: m.winner }, team),
  }
  const left = [START_LINES, START_LINES]
  for (const h of m.hands) {
    const r = h.result
    if (!r) continue
    // `Crossed` is the stake: the last hand can end the tree with fewer lines left.
    const crossed = r.crossed.map((n, t) => Math.min(n, left[t]))
    left[0] -= crossed[0]
    left[1] -= crossed[1]
    if (r.koei) left[r.playing]++
    if (crossed[team] === 2) s.doubles++
    if (crossed[team] === 3) s.triples++
    if (h.contract?.bidder === seat) {
      s.bidsMade++
      // A 20-20 draw crosses nothing: no bid won.
      if (crossed[team] > 0) s.bidsWon++
    }
  }
  return s
}

/** `players`: another seat had a human at the table; `bots`: the other three were all bots. */
export type StatsGroup = 'players' | 'bots'
export type GroupStats = Record<StatsGroup, PlayerStats>

/** A `mixed` seat was played by a human for part of the match. */
export function matchGroup(m: KjnMatch, seat: number): StatsGroup {
  return m.seats.some((k, i) => i !== seat && (k === 'human' || k === 'mixed')) ? 'players' : 'bots'
}

export const sumGroups = (g: GroupStats): PlayerStats => add(g.players, g.bots)

const emptyGroups = (): GroupStats => ({ players: { ...EMPTY_STATS }, bots: { ...EMPTY_STATS } })

/** Adds each entry's numbers to its group in `into`. */
function addEntries(into: GroupStats, entries: { seat: number; kjn: string }[]): GroupStats {
  for (const e of entries) {
    try {
      const m = parseKjn(e.kjn)
      const g = matchGroup(m, e.seat)
      into[g] = add(into[g], matchStats(m, e.seat))
    } catch {
      // Not a record: counts nothing.
    }
  }
  return into
}

function readDropped(store: KeyValueStore): GroupStats {
  try {
    const saved = JSON.parse(store.getItem(STATS_KEY) ?? '{}') as Partial<Record<StatsGroup, Partial<PlayerStats>>>
    return { players: { ...EMPTY_STATS, ...saved.players }, bots: { ...EMPTY_STATS, ...saved.bots } }
  } catch {
    return emptyGroups()
  }
}

/** Matches leave the history: keep their numbers in the stored totals. */
export function keepDropped(entries: { seat: number; kjn: string }[], store: KeyValueStore = safeStorage): void {
  if (!entries.length) return
  try {
    store.setItem(STATS_KEY, JSON.stringify(addEntries(readDropped(store), entries)))
  } catch {
    // Storage full or blocked: these matches no longer count.
  }
}

/** The matches in the history plus the ones that dropped out of it, per group. */
export function totalStats(entries: { seat: number; kjn: string }[], store: KeyValueStore = safeStorage): GroupStats {
  return addEntries(readDropped(store), entries)
}
