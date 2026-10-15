import { describe, expect, it } from 'vitest'
import { fullDeck, sameCard } from '../src/engine'
import type { Action, Card, LogEvent, State } from '../src/engine'
import { LOSS_LIMITS, rateDecision, ratingClass, summarize } from '../src/bots/analysis'
import type { Rating } from '../src/bots/analysis'
import { Analyzer, matchSeed, rateStep, stepDecisions } from '../src/lib/analysis'
import type { AnalysisPort, AnalysisRequest, AnalysisResult } from '../src/lib/analysis'
import { loadKjn, parseKjn, replayMoves, replaySteps } from '../src/lib/kjn'
import { seededRandom } from '../src/lib/seed'
import { biddingState, C, finishedMatch, hideOthers, lastTrickState, playingState } from './helpers'

function replay(seed: number) {
  const { kjn } = finishedMatch(seed)
  const m = parseKjn(kjn)
  return { kjn, m, ...replayMoves(m) }
}

/** The first replay step after step `from` whose decision `pick` accepts. */
function findDecision(r: ReturnType<typeof replay>, pick: (a: Action) => boolean, from = 0) {
  for (let k = from; k < r.steps.length; k++) {
    const d = stepDecisions(r.steps, r.moves, k).find((d) => pick(d.played) && rateDecision(d.state, d.seat, { played: d.played, seed: 1, samples: 1 }))
    if (d) return d
  }
  throw new Error('no such decision')
}

/**
 * Seat 0 (the bidder, trump hearts) plays last to the 5th trick: the ace takes 9
 * points and 21 in all; the 10 gives the trick and the hand to the defenders.
 * The log holds every card played, so the three hidden cards are 0-point nines.
 */
function endPosition(): State {
  const tricks: [number, Card][][] = [
    [[1, C('H', '10')], [2, C('H', 'J')], [3, C('H', 'Q')], [0, C('H', 'K')]],
    [[1, C('H', 'A')], [2, C('D', '10')], [3, C('D', 'J')], [0, C('D', 'Q')]],
    [[1, C('C', '10')], [2, C('C', 'J')], [3, C('C', 'Q')], [0, C('C', 'K')]],
    [[2, C('C', 'A')], [3, C('D', 'K')], [0, C('D', 'A')], [1, C('S', 'J')]],
    [[1, C('S', 'Q')], [2, C('S', '9')], [3, C('S', 'K')]],
  ]
  const log: LogEvent[] = [{ t: 'deal', seat: 3 }, ...tricks.flat().map(([seat, card]) => ({ t: 'card', seat, card }))]
  return playingState({
    dealer: 3,
    bidder: 0,
    trump: 'H',
    tricksPlayed: 4,
    tricksWon: [2, 2],
    points: [12, 19],
    leader: 1,
    turn: 0,
    trick: tricks[4].map(([seat, card]) => ({ seat, card })),
    hands: [[C('S', 'A'), C('S', '10')], [C('H', '9')], [C('C', '9')], [C('D', '9')]],
    log,
  })
}

/** Round 1, dealer 0, trump proposal hearts: seat 1 holds `cards`, the rest is dealt around. */
function bidFor(cards: Card[]): State {
  const first = C('H', '9')
  const second = C('S', 'Q')
  const s = biddingState(first, second, 0)
  const rest = fullDeck().filter((c) => ![...cards, first, second].some((k) => sameCard(k, c)))
  s.hands = [[...rest.slice(0, 4), second, first], cards, rest.slice(4, 10), rest.slice(10, 16)]
  return s
}

const bid = (play: boolean): Action => ({ type: 'bid', seat: 1, play })

describe('rateDecision', () => {
  it('gives every legal action a value, the best first, and the loss of the played one', () => {
    const r = replay(3)
    const d = findDecision(r, (a) => a.type === 'play')
    const rating = rateDecision(d.state, d.seat, { played: d.played, seed: 5 })!
    expect(rating.kind).toBe('play')
    expect(rating.values.length).toBeGreaterThan(1)
    expect(rating.values.map((v) => v.value)).toEqual(rating.values.map((v) => v.value).sort((a, b) => b - a))
    const mine = rating.values.find((v) => v.action.type === 'play' && d.played.type === 'play' && sameCard(v.action.card, d.played.card))!
    expect(rating.loss).toBeCloseTo(rating.values[0].value - mine.value)
    expect(rating.rating).toBe(ratingClass(rating.loss, 'play'))
  })

  it('uses only what the seat can know: other hidden hands give the same rating', () => {
    const r = replay(4)
    const rand = seededRandom(9)
    for (const pick of [(a: Action) => a.type === 'play', (a: Action) => a.type === 'bid']) {
      const d = findDecision(r, pick, 30)
      const rate = (s: State) => rateDecision(s, d.seat, { played: d.played, seed: 77, samples: 20 })
      const other = hideOthers(d.state, d.seat, rand)
      expect(other.hands).not.toEqual(d.state.hands)
      expect(rate(other)).toEqual(rate(d.state))
    }
  })

  it('gives the same rating for the same match and step', () => {
    const a = replay(5)
    const b = replay(5)
    expect(matchSeed(a.m)).toBe(matchSeed(b.m))
    const k = a.steps.findIndex((_, i) => stepDecisions(a.steps, a.moves, i)[0]?.played.type === 'play' && i > 40)
    const one = rateStep(a.steps, a.moves, k, matchSeed(a.m))
    expect(one.length).toBeGreaterThan(0)
    expect(rateStep(b.steps, b.moves, k, matchSeed(b.m))).toEqual(one)
    // The same match from a file with other line endings; another match gets another seed.
    expect(matchSeed(loadKjn(a.kjn.replace(/\n/g, '\r\n') + '\n').match)).toBe(matchSeed(a.m))
    expect(matchSeed(a.m)).not.toBe(matchSeed(replay(6).m))
  })

  it('rates the winning card of an end position Best and the losing one a blunder', () => {
    const s = endPosition()
    const ace = rateDecision(s, 0, { played: { type: 'play', seat: 0, card: C('S', 'A') }, seed: 1 })!
    const ten = rateDecision(s, 0, { played: { type: 'play', seat: 0, card: C('S', '10') }, seed: 1 })!
    expect(ace.rating).toBe('best')
    expect(ace.values[0].value).toBe(1)
    expect(ten.rating).toBe('blunder')
    // The bidder crosses 1 line with the ace and gets a koei with the 10.
    expect(ten.loss).toBe(3)
  })

  it('rates a pass with four trumps and the ace and king as a mistake, and the bid as Best', () => {
    const s = bidFor([C('H', 'A'), C('H', 'K'), C('H', 'Q'), C('H', 'J'), C('S', 'A'), C('C', 'A')])
    const go = rateDecision(s, 1, { played: bid(true), seed: 3 })!
    const pass = rateDecision(s, 1, { played: bid(false), seed: 3 })!
    expect(go.kind).toBe('bidding')
    expect(go.rating).toBe('best')
    expect(['mistake', 'blunder']).toContain(pass.rating)
    expect(go.stake).toBe(1)
    expect(go.breakEven).toBeCloseTo(2 / 3)
    const values = go.values.find((v) => v.action.type === 'bid' && v.action.play)!
    expect(values.win).toBeGreaterThan(go.breakEven!)
  })

  it('rates a bid without a trump as a mistake, and the pass as Best', () => {
    const s = bidFor([C('S', '9'), C('S', '10'), C('C', '9'), C('C', '10'), C('D', '9'), C('D', 'J')])
    expect(rateDecision(s, 1, { played: bid(false), seed: 3 })!.rating).toBe('best')
    expect(['mistake', 'blunder']).toContain(rateDecision(s, 1, { played: bid(true), seed: 3 })!.rating)
  })

  it('rates no step without a real choice', () => {
    // A lone card, a lift, and the deal.
    const last = lastTrickState({ trick: [], turn: 1, card: C('S', 'A') })
    expect(rateDecision(last, 1, { played: { type: 'play', seat: 1, card: C('S', 'A') }, seed: 1 })).toBeNull()
    const r = replay(2)
    expect(r.moves[0]).toBeNull()
    expect(rateStep(r.steps, r.moves, 0, 1)).toEqual([])
    const cut = { ...r.steps.find((s) => s.phase === 'CUTTING')! }
    expect(rateDecision(cut, (cut.dealer + 3) % 4, { played: { type: 'cut', seat: (cut.dealer + 3) % 4, n: 10 }, seed: 1 })).toBeNull()
  })
})

describe('replay decisions', () => {
  it('come with the same steps as replaySteps', () => {
    const r = replay(1)
    expect(r.steps).toEqual(replaySteps(r.m))
    expect(r.moves).toHaveLength(r.steps.length)
  })

  it("also rate the bidder's choice not to ask a troefke, at the partner's first lead", () => {
    let seen = 0
    for (let seed = 1; seed <= 8; seed++) {
      const r = replay(seed)
      r.steps.forEach((_, k) => {
        const ds = stepDecisions(r.steps, r.moves, k)
        if (ds.length < 2) return
        seen++
        const [ack, lead] = ds
        expect(ack.played).toEqual({ type: 'ack', seat: lead.state.bidder })
        expect(lead.played.type).toBe('play')
        expect(lead.state.tricksPlayed).toBe(0)
        const rating = rateDecision(ack.state, ack.seat, { played: ack.played, seed: 1, samples: 5 })!
        expect(rating.kind).toBe('bidding')
        // The contract stands: no break-even of a bid.
        expect(rating.breakEven).toBeUndefined()
      })
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('rating classes', () => {
  it('follow the loss limits per kind of decision', () => {
    expect(ratingClass(0, 'play')).toBe('best')
    expect(ratingClass(LOSS_LIMITS.play[1], 'play')).toBe('good')
    expect(ratingClass(LOSS_LIMITS.play[3] + 0.01, 'play')).toBe('blunder')
    expect(ratingClass(LOSS_LIMITS.bidding[0], 'bidding')).toBe('best')
  })

  it('count per seat, with bidding and card play apart', () => {
    const r = (seat: number, kind: 'play' | 'bidding', rating: Rating['rating']) => ({ seat, kind, rating }) as Rating
    const sum = summarize([r(0, 'play', 'best'), r(0, 'play', 'best'), r(0, 'bidding', 'mistake'), r(3, 'play', 'blunder')])
    expect(sum[0].play.best).toBe(2)
    expect(sum[0].bidding.mistake).toBe(1)
    expect(sum[3].play.blunder).toBe(1)
    expect(sum[1].play.best).toBe(0)
  })
})

describe('Analyzer', () => {
  function fakePort() {
    const sent: AnalysisRequest[] = []
    let stopped = false
    const port: AnalysisPort & { sent: AnalysisRequest[]; stopped(): boolean; reply(step: number): void } = {
      sent,
      onmessage: null,
      onerror: null,
      postMessage: (m) => sent.push(m),
      terminate: () => (stopped = true),
      stopped: () => stopped,
      reply: (step) => port.onmessage!({ data: { step, ratings: [] } } as unknown as MessageEvent<AnalysisResult>),
    }
    return port
  }
  const steps = (sent: AnalysisRequest[]) => sent.flatMap((m) => ('step' in m ? [m.step] : []))

  it('sends the match once, then one step at a time, the latest wish first', () => {
    const port = fakePort()
    const a = new Analyzer(port, 'KJN')
    expect(port.sent[0]).toEqual({ kjn: 'KJN' })
    a.want([3, 4, 5])
    expect(steps(port.sent)).toEqual([3])
    // The viewer moved on: step 4 and 5 are no longer wanted.
    a.want([9])
    port.reply(3)
    expect(steps(port.sent)).toEqual([3, 9])
    port.reply(9)
    let results = new Map<number, Rating[]>()
    a.results.subscribe((m) => (results = m))
    expect([...results.keys()]).toEqual([3, 9])
  })

  it('turned off, sends no more steps', () => {
    const port = fakePort()
    const a = new Analyzer(port, 'KJN')
    a.want([1, 2, 3])
    a.want([])
    port.reply(1)
    expect(steps(port.sent)).toEqual([1])
  })

  it('reports a failed worker and stops it', () => {
    const port = fakePort()
    const a = new Analyzer(port, 'KJN')
    let failed = false
    a.failed.subscribe((f) => (failed = f))
    a.want([1])
    port.onerror!(new Event('error') as ErrorEvent)
    expect(failed).toBe(true)
    expect(port.stopped()).toBe(true)
  })

  it('never rates a step twice', () => {
    const port = fakePort()
    const a = new Analyzer(port, 'KJN')
    a.want([1])
    port.reply(1)
    a.want([1, 2])
    expect(steps(port.sent)).toEqual([1, 2])
  })
})
