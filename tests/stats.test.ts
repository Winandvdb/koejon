import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, clientState, matchScore, toPublic } from '../src/engine'
import type { MatchStats, State } from '../src/engine'
import { loadStats, recordMatch } from '../src/lib/stats'
import type { KeyValueStore } from '../src/lib/link-local'
import { biddingState, C, lastTrickState, playingState } from './helpers'

// All-9s/10s trick: zero card points, seat 0 wins it with the SK.
const TRICK = [
  { seat: 1, card: C('S', '10') },
  { seat: 2, card: C('S', '9') },
  { seat: 3, card: C('S', 'J') },
]

// Seats 0 and 2 (team 0) take the last trick: seat 2 already leads with SA.
const TEAM0_TRICK = [
  { seat: 1, card: C('S', '10') },
  { seat: 2, card: C('S', 'A') },
  { seat: 3, card: C('S', '9') },
]

describe('engine match stats', () => {
  it('counts "ik ga" as a bid made for that seat', () => {
    const s = apply(biddingState(C('H', '9'), C('S', '9')), { type: 'bid', seat: 1, play: true })
    expect(s.stats.bidsMade).toEqual([0, 1, 0, 0])
  })

  it("counts the dealer's trump choice as a bid made", () => {
    let s = biddingState(C('H', '9'), C('H', '10'))
    for (const seat of [1, 2, 3]) s = apply(s, { type: 'bid', seat, play: false })
    expect(s.phase).toBe('DEALER_CHOICE')
    s = apply(s, { type: 'choose', seat: 0, suit: 'H' })
    expect(s.stats.bidsMade).toEqual([1, 0, 0, 0])
  })

  it('a dealer pass is no bid', () => {
    let s = biddingState(C('H', '9'), C('H', '10'))
    for (const seat of [1, 2, 3]) s = apply(s, { type: 'bid', seat, play: false })
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.stats.bidsMade).toEqual([0, 0, 0, 0])
  })

  it('a single line: no double, bid won for the bidder', () => {
    const s = lastTrickState({ bidder: 1, points: [19, 21], trick: TRICK, turn: 0, card: C('S', 'K') })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'K') })
    expect(s2.lastResult!.erased).toBe(1)
    expect(s2.stats).toEqual({ doubles: [0, 0], triples: [0, 0], bidsMade: [0, 0, 0, 0], bidsWon: [0, 1, 0, 0] })
  })

  it('second card win: a double for the playing team', () => {
    const s = lastTrickState({ bidder: 1, level: 2, points: [10, 30], tricksWon: [2, 3], trick: TRICK, turn: 0, card: C('S', 'K') })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'K') })
    expect(s2.lastResult!.erased).toBe(2)
    expect(s2.stats.doubles).toEqual([0, 1])
    expect(s2.stats.bidsWon).toEqual([0, 1, 0, 0])
  })

  it('defending kapot on the first card: a double for the defenders, bid lost', () => {
    const s = lastTrickState({ bidder: 1, points: [40, 0], tricksWon: [5, 0], trick: TEAM0_TRICK, turn: 0, card: C('S', 'Q') })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'Q') })
    expect(s2.lastResult!.erased).toBe(2)
    expect(s2.stats.doubles).toEqual([1, 0])
    expect(s2.stats.bidsWon).toEqual([0, 0, 0, 0])
  })

  it('second card + kapot: a triple', () => {
    const s = lastTrickState({ bidder: 0, level: 2, points: [40, 0], tricksWon: [5, 0], trick: TEAM0_TRICK, turn: 0, card: C('S', 'Q') })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'Q') })
    expect(s2.lastResult!.erased).toBe(3)
    expect(s2.stats.triples).toEqual([1, 0])
    expect(s2.stats.doubles).toEqual([0, 0])
    expect(s2.stats.bidsWon).toEqual([1, 0, 0, 0])
  })

  it('20-20: no crosses, bid not won', () => {
    const s = lastTrickState({ bidder: 1, points: [20, 20], trick: TRICK, turn: 0, card: C('S', 'K') })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'K') })
    expect(s2.lastResult!.draw).toBe(true)
    expect(s2.stats.bidsWon).toEqual([0, 0, 0, 0])
    expect(s2.stats.doubles).toEqual([0, 0])
  })

  it('stats are public, so a reloaded guest keeps them', () => {
    const stats: MatchStats = { doubles: [1, 2], triples: [0, 1], bidsMade: [3, 1, 0, 2], bidsWon: [2, 1, 0, 1] }
    const s = playingState({ stats })
    expect(toPublic(s).stats).toEqual(stats)
    expect(clientState(toPublic(s), 2, []).stats).toEqual(stats)
  })

  it('an engine state saved before stats existed resumes with zero counts', () => {
    const { stats: _, ...old } = biddingState(C('H', '9'), C('S', '9'))
    const s = apply(old as State, { type: 'bid', seat: 1, play: true })
    expect(s.stats.bidsMade).toEqual([0, 1, 0, 0])
  })
})

describe('matchScore', () => {
  it('the winner gets 13', () => {
    expect(matchScore({ lines: [0, 5], winner: 0 }, 0)).toBe(13)
  })

  it('a normal loss: 13 minus the lines left', () => {
    expect(matchScore({ lines: [0, 5], winner: 0 }, 1)).toBe(8)
  })

  it('a loss with more than 13 lines left (Koeien) gives 0', () => {
    expect(matchScore({ lines: [16, 0], winner: 1 }, 0)).toBe(0)
  })
})

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function finished(log = [{ t: 'game-over', team: 1 }]) {
  return toPublic(
    playingState({
      phase: 'GAME_OVER',
      winner: 1,
      lines: [5, 0],
      stats: { doubles: [1, 2], triples: [0, 1], bidsMade: [3, 4, 1, 2], bidsWon: [1, 3, 0, 2] },
      log,
    }),
  )
}

describe('recordMatch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('adds the own seat and team numbers', () => {
    const st = memStore()
    expect(recordMatch('ABCDE', finished(), 3, st)).toBe(true)
    expect(loadStats(st)).toEqual({ played: 1, won: 1, score: 13, doubles: 2, triples: 1, bidsMade: 2, bidsWon: 2 })
    expect(recordMatch('X', finished([{ t: 'other' }]), 0, st)).toBe(true)
    expect(loadStats(st)).toEqual({ played: 2, won: 1, score: 21, doubles: 3, triples: 1, bidsMade: 5, bidsWon: 3 })
  })

  it('counts a match once, also after a reload on the end screen', () => {
    const st = memStore()
    expect(recordMatch('ABCDE', finished(), 0, st)).toBe(true)
    expect(recordMatch('ABCDE', structuredClone(finished()), 0, st)).toBe(false)
    expect(loadStats(st).played).toBe(1)
  })

  it('counts nothing before GAME_OVER', () => {
    const st = memStore()
    expect(recordMatch('ABCDE', toPublic(playingState()), 0, st)).toBe(false)
    expect(st.data.size).toBe(0)
  })

  it('blocked storage never throws', () => {
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(recordMatch('ABCDE', finished(), 0, bad)).toBe(false)
    expect(loadStats(bad).played).toBe(0)
  })

  it('asks for persistent storage once, at the first counted match', () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })
    const st = memStore()
    recordMatch('ABCDE', finished(), 0, st)
    recordMatch('FGHIJ', finished([{ t: 'other' }]), 0, st)
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
