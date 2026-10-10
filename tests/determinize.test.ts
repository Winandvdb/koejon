import { beforeAll, describe, expect, it } from 'vitest'
import {
  apply,
  createMatch,
  fullDeck,
  isBidding,
  legalActions,
  pendingSeats,
  RANK_ORDER,
  sameCard,
} from '../src/engine'
import type { Card, State, Suit, TrickCard } from '../src/engine'
import { botAction } from '../src/bots/bot'
import { sampleWorld } from '../src/bots/determinize'
import { observe } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { dealtState } from './helpers'

interface Position {
  s: State
  /** Cards played this hand so far, in order — the ground truth. */
  played: TrickCard[]
}

const keyOf = (c: Card): string => c.s + c.r

/** Run a bot match and snapshot every PLAYING state with its play history. */
function positions(seed: number): Position[] {
  let s = createMatch(seed)
  const rand = seededRandom(seed * 7919 + 13)
  const out: Position[] = []
  let played: TrickCard[] = []
  let guard = 20000
  while (s.phase !== 'GAME_OVER' && guard-- > 0) {
    const a = botAction(s, pendingSeats(s)[0], rand)
    if (a.type === 'deal') played = []
    if (s.phase === 'PLAYING') out.push({ s, played: [...played] })
    s = apply(s, a)
    if (a.type === 'play') played.push({ seat: a.seat, card: a.card })
  }
  return out
}

/**
 * Suits each seat is known to be out of, read off the recorded plays alone:
 * a card that `legalCards` would forbid while the seat still held the led
 * suit — not led, and not a trump over the trumps down — proves the void.
 */
function voids(played: TrickCard[], trump: Suit | null): Set<Suit>[] {
  const out = [new Set<Suit>(), new Set<Suit>(), new Set<Suit>(), new Set<Suit>()]
  for (let i = 0; i + 1 < played.length; i += 4) {
    const led = played[i].card.s
    let top = played[i].card.s === trump ? RANK_ORDER[played[i].card.r] : 0
    for (let p = 1; p < 4 && i + p < played.length; p++) {
      const { seat, card } = played[i + p]
      if (card.s !== led && !(card.s === trump && RANK_ORDER[card.r] > top)) out[seat].add(led)
      if (card.s === trump) top = Math.max(top, RANK_ORDER[card.r])
    }
  }
  return out
}

const POSITIONS: Position[] = []
beforeAll(() => {
  for (let seed = 1; seed <= 10; seed++) POSITIONS.push(...positions(seed))
}, 120_000)

describe('sampleWorld', () => {
  it('fixes the seen cards and fills each hand to its known count', () => {
    const rand = seededRandom(11)
    for (const { s, played } of POSITIONS.filter((_, i) => i % 9 === 0)) {
      for (const seat of [0, 1, 2, 3]) {
        const obs = observe(s, seat)
        const world = sampleWorld(obs, rand)
        expect(world.hands[seat].map(keyOf).sort()).toEqual(obs.hand.map(keyOf).sort())
        for (let i = 0; i < 4; i++) expect(world.hands[i]).toHaveLength(obs.handCounts[i])
        // Each of the 24 cards exactly once, split between hands and played.
        const all = [...world.hands.flat(), ...played.map((tc) => tc.card)]
        expect(new Set(all.map(keyOf)).size).toBe(24)
        // The play history and the seat's legal moves are unchanged.
        expect(world.trick).toEqual(obs.trick)
        expect(world.lastTrick).toEqual(obs.lastTrick)
        expect(legalActions(world, seat)).toEqual(obs.legal)
        // Unplayed turned cards still sit in the dealer's hand.
        const playedKeys = new Set(played.map((tc) => keyOf(tc.card)))
        for (const c of [obs.turned?.first, obs.turned?.second]) {
          if (c && !playedKeys.has(keyOf(c))) {
            expect(world.hands[obs.dealer].some((h) => sameCard(h, c))).toBe(true)
          }
        }
      }
    }
  })

  it('never deals a seat a card of a suit it proved void in', () => {
    const rand = seededRandom(23)
    let checked = 0
    for (const { s, played } of POSITIONS.filter((_, i) => i % 9 === 0)) {
      const v = voids(played, s.trump)
      for (const seat of [0, 1, 2, 3]) {
        const world = sampleWorld(observe(s, seat), rand)
        for (let i = 0; i < 4; i++) {
          for (const c of world.hands[i]) {
            expect(v[i].has(c.s), `seat ${i} holds ${keyOf(c)} of a void suit`).toBe(false)
          }
        }
        checked += v.reduce((n, x) => n + x.size, 0)
      }
    }
    expect(checked).toBeGreaterThan(0) // the positions really showed voids
  })

  it('plays every sampled world to the end of the hand', () => {
    const rand = seededRandom(31)
    const picks = POSITIONS.filter((_, i) => i % 19 === 0)
    for (let pi = 0; pi < picks.length; pi++) {
      const world = sampleWorld(observe(picks[pi].s, pi % 4), rand)
      let w = world
      let guard = 500
      while (w.phase === 'PLAYING' && guard-- > 0) {
        const seats = pendingSeats(w)
        const seat = seats[Math.floor(rand() * seats.length)]
        const legal = legalActions(w, seat)
        w = apply(w, legal[Math.floor(rand() * legal.length)])
      }
      expect(w.tricksPlayed).toBe(6)
      expect(w.phase).not.toBe('PLAYING')
    }
  })

  it('repeats a world for the same seed', () => {
    const pos = POSITIONS.find((p) => p.played.length === 0)!
    const obs = observe(pos.s, 1)
    const a = sampleWorld(obs, seededRandom(5))
    const b = sampleWorld(obs, seededRandom(5))
    expect(a).toEqual(b)
    const c = sampleWorld(obs, seededRandom(6))
    expect(c.hands).not.toEqual(a.hands)
  })

  it('deals a hidden card to each possible seat at about the fair rate', () => {
    const pos = POSITIONS.find((p) => p.played.length === 0)!
    const obs = observe(pos.s, 1)
    const fixed = new Set(obs.hand.map(keyOf))
    for (const c of [obs.turned?.first, obs.turned?.second]) if (c) fixed.add(keyOf(c))
    const hidden = fullDeck().filter((c) => !fixed.has(keyOf(c)))[0]
    const N = 3000
    const counts = [0, 0, 0, 0]
    const rand = seededRandom(3)
    for (let i = 0; i < N; i++) {
      const world = sampleWorld(obs, rand)
      for (let seat = 0; seat < 4; seat++) {
        if (world.hands[seat].some((c) => sameCard(c, hidden))) counts[seat]++
      }
    }
    expect(counts[obs.seat]).toBe(0)
    // Each seat draws its share of the hidden pool: p_i = need_i / pool.
    const must = obs.turned ? [obs.turned.first, obs.turned.second].filter(Boolean).length : 0
    const pool = 24 - obs.hand.length - must
    for (const seat of [0, 2, 3]) {
      const need = obs.handCounts[seat] - (seat === obs.dealer ? must : 0)
      const p = need / pool
      expect(Math.abs(counts[seat] - N * p)).toBeLessThan(6 * Math.sqrt(N * p * (1 - p)))
    }
  })

  it('samples the cards a bidding dealer may not look at', () => {
    const s = dealtState(4, 2)
    const obs = observe(s, 2)
    expect(obs.hand).toHaveLength(0) // the dealer's hand lies on the table
    const rand = seededRandom(9)
    let w = sampleWorld(obs, rand)
    expect(w.hands[2]).toHaveLength(6)
    expect(w.hands[2].some((c) => sameCard(c, s.turned!.first))).toBe(true)
    // The world plays on from BIDDING_R1 to the end of the hand.
    let guard = 500
    while ((w.phase === 'PLAYING' || isBidding(w.phase)) && guard-- > 0) {
      const seats = pendingSeats(w)
      const seat = seats[Math.floor(rand() * seats.length)]
      const legal = legalActions(w, seat)
      w = apply(w, legal[Math.floor(rand() * legal.length)])
    }
    expect(isBidding(w.phase) || w.phase === 'PLAYING').toBe(false)
  })

  it('still returns a fitting world when a weight keeps rejecting', () => {
    const pos = POSITIONS.find((p) => p.played.length > 0)!
    const obs = observe(pos.s, 0)
    const world = sampleWorld(obs, seededRandom(1), () => 0)
    expect(world.hands[0].map(keyOf).sort()).toEqual(obs.hand.map(keyOf).sort())
    for (let i = 0; i < 4; i++) expect(world.hands[i]).toHaveLength(obs.handCounts[i])
  })

  it('samples 1000 mid-hand worlds fast enough for search', () => {
    const pos = POSITIONS.find((p) => p.played.length >= 8 && p.s.trick.length === 0)!
    const obs = observe(pos.s, pos.s.turn)
    const rand = seededRandom(1)
    const t0 = performance.now()
    for (let i = 0; i < 1000; i++) sampleWorld(obs, rand)
    const ms = performance.now() - t0
    console.log(`sampleWorld: 1000 mid-hand samples in ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(30_000)
  })
})
