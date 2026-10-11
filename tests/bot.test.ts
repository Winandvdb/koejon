import { describe, expect, it } from 'vitest'
import { botAction } from '../src/bots/bot'
import { createAlgorithm } from '../src/bots/algorithm'
import type { BotTrace } from '../src/bots/algorithm'
import { observe } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { C, playingState } from './helpers'
import { apply, createMatch } from '../src/engine'
import type { Card, State } from '../src/engine'

const smart = () => 0 // rand < any threshold → deterministic smart path
const never = () => 0.99 // rand > all thresholds

/** BIDDING_R1 with seat 1 to speak; `hand` is seat 1's cards. */
function bidState(hand: Card[], over: Partial<State> = {}): State {
  const hands: Card[][] = [[], [], [], []]
  hands[1] = hand
  return playingState({
    phase: 'BIDDING_R1',
    dealer: 0,
    hands,
    turned: { first: C('H', 'Q'), second: C('S', '9'), secondUp: false },
    trump: null,
    bidder: null,
    turn: 1,
    ...over,
  })
}

// Two low hearts (trump of the first card), nothing else.
const TRASH = [C('H', '9'), C('H', '10'), C('C', '9'), C('C', '10'), C('D', '9'), C('D', '10')]
const NO_TRUMP = [C('S', 'A'), C('D', 'A'), C('C', 'A'), C('S', 'K'), C('D', 'K'), C('C', 'K')]

describe('bot bidding', () => {
  it('never bids without trump, not even to knijpen or to win the match', () => {
    for (const lines of [[2, 13], [13, 1]] as [number, number][]) {
      const s = bidState(NO_TRUMP, { lines })
      expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
    }
  })

  it('a lone trump bids only with a high trump and a very strong hand', () => {
    const aces = [C('S', 'A'), C('D', 'A'), C('C', 'A'), C('S', 'K'), C('D', 'K')]
    // Lone queen of trump: pass, even with three aces and to knijpen.
    const lowLone = bidState([C('H', 'Q'), ...aces], { lines: [2, 13] })
    expect(botAction(lowLone, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
    // Lone ace of trump with three aces and two guarded kings: go.
    const topLone = bidState([C('H', 'A'), ...aces])
    expect(botAction(topLone, 1, never)).toEqual({ type: 'bid', seat: 1, play: true })
    // Lone ace of trump with one side ace: pass.
    const weak = [C('H', 'A'), C('S', 'A'), C('S', '9'), C('D', '9'), C('C', '9'), C('C', '10')]
    expect(botAction(bidState(weak), 1, never)).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('knijpen: bids a trash hand when opponents sit at 2 lines', () => {
    const s = bidState(TRASH, { lines: [2, 13] }) // seat1 = team1, opp = team0
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: true })
  })

  it('no knijpen at 1 opponent line — every loss is fatal anyway', () => {
    const s = bidState(TRASH, { lines: [1, 13] })
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('no knijpen when the doubled stake already covers their 2 lines', () => {
    const s = bidState(TRASH, { lines: [2, 13], multiplier: 2 })
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('bids a strong hand regardless of the score', () => {
    const s = bidState([C('H', 'A'), C('H', 'K'), C('H', '9'), C('S', 'A'), C('D', 'A'), C('C', '9')])
    expect(botAction(s, 1, never)).toEqual({ type: 'bid', seat: 1, play: true })
  })

  it('waits on the first card with a decent hand — the 2nd card doubles the stake', () => {
    // 12.5 rated for hearts: enough for the 2nd card, not for the 1st.
    const hand = [C('H', 'A'), C('H', 'K'), C('H', '9'), C('D', 'K'), C('C', '10'), C('C', '9')]
    expect(botAction(bidState(hand), 1, never)).toEqual({ type: 'bid', seat: 1, play: false })
    const r2 = bidState(hand, {
      phase: 'BIDDING_R2',
      turned: { first: C('S', '9'), second: C('H', 'Q'), secondUp: true },
    })
    expect(botAction(r2, 1, never)).toEqual({ type: 'bid', seat: 1, play: true })
  })

  it('bids that hand on the 1st card too once the stake is doubled', () => {
    const hand = [C('H', 'A'), C('H', 'K'), C('H', '9'), C('D', 'K'), C('C', '10'), C('C', '9')]
    expect(botAction(bidState(hand, { multiplier: 2 }), 1, never)).toEqual({
      type: 'bid',
      seat: 1,
      play: true,
    })
  })

  it('two low trumps never go on the 1st card, aces or not', () => {
    const hand = [C('H', 'J'), C('H', '9'), C('S', 'A'), C('D', 'A'), C('C', 'A'), C('C', '9')]
    expect(botAction(bidState(hand), 1, never)).toEqual({ type: 'bid', seat: 1, play: false })
    const r2 = bidState(hand, {
      phase: 'BIDDING_R2',
      turned: { first: C('S', '9'), second: C('H', 'Q'), secondUp: true },
    })
    expect(botAction(r2, 1, never)).toEqual({ type: 'bid', seat: 1, play: true })
  })

  it('waits for the 2nd card when the hand fits another suit clearly better', () => {
    // Good enough for hearts, much better for spades.
    const hand = [C('H', 'K'), C('H', '9'), C('S', 'A'), C('S', 'K'), C('S', 'Q'), C('D', 'A')]
    expect(botAction(bidState(hand), 1, never)).toEqual({ type: 'bid', seat: 1, play: false })
    // Beginners do not weigh other suits.
    expect(botAction(bidState(hand), 1, never, 'easy')).toEqual({ type: 'bid', seat: 1, play: true })
  })
})

describe('bot troefke', () => {
  // Bidder 1, partner 3 leads trick 1; seat 1 still owes its ack.
  const troefkeState = (hand: Card[]) => {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = hand
    hands[3] = [C('H', '10'), C('C', '9'), C('D', '9'), C('S', '9'), C('S', '10'), C('C', '10')]
    return playingState({
      bidder: 1,
      turn: 3,
      leader: 3,
      trickAcks: [3],
      hands,
    })
  }

  it('asks with a strong trump hand — the ask doubles as the ack', () => {
    const s = troefkeState([C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')])
    expect(botAction(s, 1, smart)).toEqual({ type: 'troefke', seat: 1 })
  })

  it('stays silent with a weak trump hand', () => {
    const s = troefkeState([C('H', '9'), C('S', '9'), C('S', '10'), C('C', '9'), C('D', '9'), C('D', '10')])
    expect(botAction(s, 1, smart)).toEqual({ type: 'ack', seat: 1 })
  })

  it('a bidder that already confirmed is never asked: troefke alone is an error', () => {
    const s = { ...troefkeState(TRASH), trickAcks: [0, 1, 2, 3] }
    expect(() => botAction(s, 1, smart)).toThrow(/only pending seats may be asked/)
  })

  it('the partner honours the request by leading their best trump', () => {
    const s = { ...troefkeState(TRASH), troefkeAsked: true, trickAcks: [0, 1, 2, 3] }
    expect(botAction(s, 3, smart)).toEqual({ type: 'play', seat: 3, card: C('H', '10') })
  })
})

describe('bot card play', () => {
  /** PLAYING, seat 1 to act on an open trick. Partner is seat 3. */
  function followState(
    trick: { seat: number; card: Card }[],
    hand: Card[],
    over: Partial<State> = {},
  ): State {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = hand
    return playingState({ bidder: 1, turn: 1, trick, hands, ...over })
  }

  it('vets a cheap point card when partner already won — keeps the ace', () => {
    // Partner (seat3) played SA on a spade lead; seat1 closes the trick.
    const s = followState(
      [
        { seat: 0, card: C('S', '9') },
        { seat: 2, card: C('S', '10') },
        { seat: 3, card: C('S', 'A') },
      ],
      [C('S', 'A'), C('S', 'J'), C('H', '9')],
    )
    // Must follow spades: SA or SJ. SA cannot overtake SA → both are safe.
    // Vets the J (1 pt) and keeps the ace for later tricks.
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('S', 'J') })
  })

  it('ducks a cheap trick even when a trump could steal it', () => {
    // Opp leads SQ (2 pts); partner sluffs S9. seat1 is void in spades.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
      ],
      [C('H', '9'), C('H', 'A'), C('D', '9'), C('D', '10'), C('C', '9'), C('D', 'J')],
    )
    // H9 would trump it, but a 2-point trick is not worth a trump that the
    // boss HA keeps safe.
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
  })

  it('contests a rich trick with the cheapest winner', () => {
    // Trick carries SQ+SA = 6 pts; seat1 is void in spades → trump it low.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
        { seat: 2, card: C('S', 'A') },
      ],
      [C('H', '9'), C('H', 'K'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10')],
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
  })

  it('does not pull trumps when only the partner can still hold them', () => {
    // Trick 1: partner's trump lead — both opponents showed out of trump.
    // Trick 2: a plain trick the opponents won, so no sweep is live.
    const hands: Card[][] = [[], [], [], []]
    hands[1] = [C('H', 'A'), C('H', 'K'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10')]
    const s = playingState({
      bidder: 1,
      turn: 1,
      tricksPlayed: 2,
      tricksWon: [1, 1],
      hands,
      log: [
        { t: 'card', seat: 3, card: C('H', 'J') },
        { t: 'card', seat: 0, card: C('S', '9') },
        { t: 'card', seat: 1, card: C('H', '9') },
        { t: 'card', seat: 2, card: C('S', '10') },
        { t: 'trick', seat: 3 },
        { t: 'card', seat: 3, card: C('S', 'Q') },
        { t: 'card', seat: 0, card: C('S', 'A') },
        { t: 'card', seat: 1, card: C('S', 'J') },
        { t: 'card', seat: 2, card: C('S', 'K') },
        { t: 'trick', seat: 0 },
      ],
    })
    // HA is boss, but pulling only draws partner's trumps → lead a plain card.
    for (const level of ['normal', 'hard'] as const) {
      expect(botAction(s, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
    }
    // Easy keeps no memory — it still leads the boss trump.
    expect(botAction(s, 1, smart, 'easy')).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
  })

  it('fights to stop the opponents crossing 21', () => {
    // Team0 at 19 — letting this 2-pt trick go gives them the hand.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 2, card: C('S', '9') },
      ],
      [C('H', '9'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')],
      { points: [19, 10] },
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
  })

  it('does not undertrump while a plain card can be discarded', () => {
    // Opp seat2 trumps a spade lead with HQ; seat1 is void in spades and the
    // cheap trick is not worth the HA. H9 would go under HQ — throw a plain card.
    const s = followState(
      [
        { seat: 0, card: C('S', '10') },
        { seat: 3, card: C('S', '9') },
        { seat: 2, card: C('H', 'Q') },
      ],
      [C('H', 'A'), C('H', '9'), C('D', 'J'), C('D', 'Q'), C('C', 'K'), C('C', 'J')],
    )
    for (const rand of [smart, never]) {
      expect(botAction(s, 1, rand)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
    }
  })

  it('does not undertrump on the 5th trick to keep a plain last card', () => {
    const s = followState(
      [
        { seat: 0, card: C('S', '10') },
        { seat: 3, card: C('S', '9') },
        { seat: 2, card: C('H', 'J') },
      ],
      [C('H', '9'), C('D', 'Q')],
      { tricksPlayed: 4, tricksWon: [2, 2] },
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', 'Q') })
  })

  it("never trumps a trick the partner's ace already wins", () => {
    // Partner seat3 leads SA; seat1 is void in spades and holds a last trump.
    const s = followState(
      [
        { seat: 3, card: C('S', 'A') },
        { seat: 0, card: C('S', '9') },
      ],
      [C('H', '9'), C('D', 'J'), C('C', '9')],
      { tricksPlayed: 3, tricksWon: [1, 2] },
    )
    for (const level of ['easy', 'normal', 'hard'] as const) {
      // Smart path vets cheap points (the jack is under every level's
      // vetMaxRisk); lazy dump and a decided hand dump the pointless nine.
      expect(botAction(s, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
      expect(botAction(s, 1, never, level)).toEqual({ type: 'play', seat: 1, card: C('C', '9') })
      const decided = { ...s, points: [5, 21] as [number, number] }
      expect(botAction(decided, 1, smart, level)).toEqual({
        type: 'play',
        seat: 1,
        card: C('C', '9'),
      })
    }
  })

  it('keeps an ace an opponent may trump; leads a low card instead', () => {
    // Four spades in hand: only 2 are out, so an opponent is likely void.
    const hands: Card[][] = [[], [], [], []]
    hands[1] = [C('S', 'A'), C('S', 'K'), C('S', 'Q'), C('S', 'J'), C('D', '9'), C('D', '10')]
    const s = playingState({ bidder: 0, turn: 1, leader: 1, hands })
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
  })

  it('cashes the ace once both opponents showed out of trump', () => {
    // Trick 1: partner led trump, both opponents sluffed → they hold no trump.
    // Trick 2: opponents won a plain trick, so no sweep is live.
    const hands: Card[][] = [[], [], [], []]
    hands[1] = [C('S', 'A'), C('S', 'K'), C('S', 'Q'), C('S', 'J')]
    const s = playingState({
      bidder: 0,
      turn: 1,
      tricksPlayed: 2,
      tricksWon: [1, 1],
      hands,
      log: [
        { t: 'card', seat: 3, card: C('H', '9') },
        { t: 'card', seat: 0, card: C('C', '9') },
        { t: 'card', seat: 1, card: C('H', '10') },
        { t: 'card', seat: 2, card: C('C', '10') },
        { t: 'trick', seat: 1 },
        { t: 'card', seat: 1, card: C('D', '10') },
        { t: 'card', seat: 2, card: C('D', 'A') },
        { t: 'card', seat: 3, card: C('D', '9') },
        { t: 'card', seat: 0, card: C('D', 'J') },
        { t: 'trick', seat: 2 },
      ],
    })
    for (const level of ['normal', 'hard'] as const) {
      expect(botAction(s, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('S', 'A') })
    }
    // Easy remembers nothing: the short suit may still be trumped.
    expect(botAction(s, 1, smart, 'easy')).toEqual({ type: 'play', seat: 1, card: C('S', 'J') })
  })

  it('trumps a scoring trick when its lone trump would be pulled anyway', () => {
    // Same spot as the duck above, but H9 is the only trump: spend it now.
    const hand = [C('H', '9'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')]
    const rich = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
      ],
      hand,
    )
    expect(botAction(rich, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
    // A trick with no points is still not worth it.
    const empty = followState(
      [
        { seat: 0, card: C('S', '10') },
        { seat: 3, card: C('S', '9') },
      ],
      hand,
    )
    expect(botAction(empty, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
  })

  it('as player 2 does not trump a low lead: the partner plays 4th', () => {
    // Opponents won both tricks (kapot live). Seat 0 leads S9, partner seat 3 plays last.
    const hand = [C('H', '9'), C('D', 'J'), C('C', 'Q'), C('D', 'Q')]
    const s = followState([{ seat: 0, card: C('S', '9') }], hand, {
      leader: 0,
      tricksPlayed: 2,
      tricksWon: [2, 0],
    })
    for (const level of ['normal', 'hard'] as const) {
      expect(botAction(s, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
    }
    // The partner plays 4th on a cheap trick with points too.
    const jack = followState([{ seat: 0, card: C('S', 'J') }], hand, { leader: 0 })
    expect(botAction(jack, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
  })

  it('does not trump a trick with no points while a plain card is legal', () => {
    // Seat 1 closes a 0-point trick; its team took both tricks (sweep live).
    const hand = [C('H', '9'), C('D', 'J'), C('C', 'Q'), C('D', 'Q')]
    const trick = [
      { seat: 2, card: C('S', '10') },
      { seat: 3, card: C('S', '9') },
      { seat: 0, card: C('C', '9') },
    ]
    const sweep = followState(trick, hand, { leader: 2, tricksPlayed: 2, tricksWon: [0, 2] })
    expect(botAction(sweep, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
    // Opponents took both tricks and the partner already played: only this
    // trump can still stop the kapot in this trick.
    const kapot = followState(trick, hand, { leader: 2, tricksPlayed: 2, tricksWon: [2, 0] })
    expect(botAction(kapot, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
  })

  it('ducks a trick not worth it with a plain card, not with a low trump', () => {
    // A 2-point trick; the boss HA keeps the H9 from being doomed. The H9 is
    // the cheapest card, but it would buy the trick: throw the DJ.
    const s = followState(
      [
        { seat: 2, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
        { seat: 0, card: C('S', '10') },
      ],
      [C('H', '9'), C('H', 'A'), C('D', 'J'), C('C', 'Q')],
      { leader: 2 },
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', 'J') })
  })

  it('after a troefke the bidder takes the trump lead with the boss trump', () => {
    // Partner seat 3 opens trump on the troefke; seat 2 still plays after the bidder.
    const troefke = { leader: 3, troefkeAsked: true }
    const hand = [C('H', 'A'), C('H', '10'), C('D', '9'), C('C', '9')]
    // The partner's HJ wins so far, but the HK is still out.
    const partnerWins = followState([{ seat: 3, card: C('H', 'J') }, { seat: 0, card: C('H', '9') }], hand, troefke)
    // An opponent tops the partner with the HQ.
    const oppWins = followState([{ seat: 3, card: C('H', '9') }, { seat: 0, card: C('H', 'Q') }], hand, troefke)
    for (const level of ['easy', 'normal', 'hard'] as const) {
      expect(botAction(partnerWins, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
      expect(botAction(oppWins, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
    }
    // The partner's HK is the highest trump left: no need to overtake it.
    const sealed = followState(
      [{ seat: 3, card: C('H', 'K') }, { seat: 0, card: C('H', '9') }],
      [C('H', 'A'), C('H', '10'), C('D', '9')],
      troefke,
    )
    expect(botAction(sealed, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '10') })
  })

  it('buys an early trick with a lone high trump that the ace will pull', () => {
    // HK is the only trump and HA is out. As player 2 on a 2-point lead it
    // buys now, also though the partner plays 4th.
    const s = followState(
      [{ seat: 0, card: C('S', 'Q') }],
      [C('H', 'K'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')],
      { leader: 0 },
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', 'K') })
    // A lone low trump trusts the partner instead.
    const low = followState(
      [{ seat: 0, card: C('S', 'Q') }],
      [C('H', '9'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')],
      { leader: 0 },
    )
    expect(botAction(low, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
  })
})

describe('bot leads', () => {
  const LEVELS = ['easy', 'normal', 'hard'] as const

  /** PLAYING, seat 1 leads. `bidder` 1 = seat 1 bids, 3 = partner bids, 0 = defending. */
  function leadState(hand: Card[], bidder: number, over: Partial<State> = {}): State {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = hand
    return playingState({ bidder, turn: 1, leader: 1, hands, ...over })
  }

  it('does not lead a side ace while an opponent may still hold trump, also at trick 1', () => {
    // Trump is always allowed: a long side suit does not stop a trump.
    const bidding = leadState([C('H', '9'), C('H', '10'), C('S', 'A'), C('D', 'A'), C('C', '9'), C('D', '10')], 1)
    const defending = leadState([C('S', 'A'), C('D', 'A'), C('D', '9'), C('C', '10'), C('C', 'Q'), C('S', 'J')], 0)
    // Only aces as plain cards: a low trump goes first.
    const onlyAces = leadState([C('H', '9'), C('H', '10'), C('S', 'A'), C('D', 'A')], 1)
    for (const level of LEVELS) {
      expect(botAction(bidding, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('C', '9') })
      expect(botAction(defending, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
      expect(botAction(onlyAces, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
    }
  })

  it('keeps a side ace in a sweep while an opponent may still hold trump', () => {
    const hand = [C('H', '9'), C('S', 'A'), C('D', 'K'), C('C', '10'), C('D', '9')]
    const sweep = { tricksPlayed: 1, tricksWon: [0, 1] as [number, number] }
    for (const level of LEVELS) {
      // Bidder, partner and short defender alike: the highest card that is no ace.
      for (const bidder of [1, 3, 0]) {
        expect(botAction(leadState(hand, bidder, sweep), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', 'K') })
      }
    }
    // The trace says why the ace waits.
    const trace: BotTrace = { candidates: [], notes: [] }
    createAlgorithm('heuristic:normal').decide(observe(leadState(hand, 3, sweep), 1), smart, trace)
    expect(trace.notes).toEqual(['sweep: highest card, keeps trump, the ace waits: an opponent may trump it'])
    // Trick 1: seat1 led trump and both opponents showed out: now the ace is safe.
    const noTrumpOut = leadState(hand, 1, {
      ...sweep,
      log: [
        { t: 'card', seat: 1, card: C('H', 'Q') },
        { t: 'card', seat: 2, card: C('C', '9') },
        { t: 'card', seat: 3, card: C('H', 'J') },
        { t: 'card', seat: 0, card: C('D', '10') },
        { t: 'trick', seat: 1 },
      ],
    })
    for (const level of ['normal', 'hard'] as const) {
      expect(botAction(noTrumpOut, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('S', 'A') })
    }
    // Easy remembers no trumps: the ace still waits.
    expect(botAction(noTrumpOut, 1, smart, 'easy')).toEqual({ type: 'play', seat: 1, card: C('D', 'K') })
  })

  it('leads a low trump before the last plain aces, also in a sweep', () => {
    const open = { tricksPlayed: 3, tricksWon: [1, 2] as [number, number] }
    const sweep = { tricksPlayed: 3, tricksWon: [0, 3] as [number, number] }
    for (const level of LEVELS) {
      for (const over of [open, sweep]) {
        const lead = (hand: Card[], bidder: number) => botAction(leadState(hand, bidder, over), 1, smart, level)
        expect(lead([C('H', '9'), C('S', 'A'), C('D', 'A')], 3)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
        // The bidder keeps its king for when the trump ace fell.
        expect(lead([C('H', 'K'), C('H', 'Q'), C('S', 'A')], 1)).toEqual({ type: 'play', seat: 1, card: C('H', 'Q') })
        expect(lead([C('H', 'A'), C('H', '9'), C('S', 'A')], 0)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
        // An ace goes only when no other card is legal: also the boss trump goes first.
        expect(lead([C('H', 'A'), C('S', 'A')], 0)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
      }
    }
  })

  it('the partner of the bidder does not lead trump, also in a sweep', () => {
    const hand = [C('H', 'A'), C('H', 'K'), C('H', '9'), C('D', '9'), C('C', '9'), C('C', '10')]
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 3), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
      const sweep = leadState(hand.filter((c) => c.r !== '9' || c.s !== 'H'), 3, { tricksPlayed: 1, tricksWon: [0, 1] })
      expect(botAction(sweep, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('C', '10') })
    }
    // A troefke request still asks the best trump.
    const asked = leadState(hand, 3, { troefkeAsked: true })
    expect(botAction(asked, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
  })

  it('a defender with only the trump ace keeps it, also in a sweep', () => {
    const hand = [C('H', 'A'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('S', '9')]
    const sweep = leadState(hand.slice(0, 5), 0, { tricksPlayed: 1, tricksWon: [0, 1] })
    // Its lower trumps stay home in a sweep too.
    const twoTrumps = leadState([C('H', 'A'), C('H', 'Q'), C('D', '9'), C('C', '9')], 0, {
      tricksPlayed: 2,
      tricksWon: [0, 2],
    })
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 0), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
      expect(botAction(sweep, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '10') })
      expect(botAction(twoTrumps, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
    }
  })

  it('a defender with side aces and few trumps leads a low trump and keeps the ace', () => {
    const hand = [C('H', 'A'), C('H', '9'), C('S', 'A'), C('D', 'A'), C('C', '9'), C('C', '10')]
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 0), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
    }
  })

  it('draws out the ace: a low card under its king while the ace is out', () => {
    // S10 gives no points away; a jack or queen under the king would.
    const hand = [C('S', 'K'), C('S', '10'), C('D', '9'), C('C', '9'), C('D', 'J'), C('C', 'J')]
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 0), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('S', '10') })
    }
    const queen = [C('S', 'K'), C('S', 'Q'), C('D', '9'), C('C', '9'), C('D', 'J'), C('C', 'J')]
    expect(botAction(leadState(queen, 0), 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
    // Trick 1 drew SA: SK is the top spade now, so a hard bot leads low elsewhere.
    // The other levels do not remember side aces.
    const aceGone = leadState(hand.slice(0, 5), 0, {
      tricksPlayed: 1,
      tricksWon: [1, 0],
      log: [
        { t: 'card', seat: 0, card: C('S', 'A') },
        { t: 'card', seat: 1, card: C('S', 'J') },
        { t: 'card', seat: 2, card: C('S', 'Q') },
        { t: 'card', seat: 3, card: C('S', '9') },
        { t: 'trick', seat: 0 },
      ],
    })
    expect(botAction(aceGone, 1, smart, 'hard')).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
    expect(botAction(aceGone, 1, smart, 'normal')).toEqual({ type: 'play', seat: 1, card: C('S', '10') })
  })

  it('leads a low trump to draw the trump ace under its king', () => {
    const hand = [C('H', 'K'), C('H', '9'), C('S', '10'), C('D', '10'), C('C', '10'), C('C', 'J')]
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 1), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
      // The partner and a short defender keep their trumps.
      for (const bidder of [3, 0]) {
        expect(botAction(leadState(hand, bidder), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('S', '10') })
      }
    }
  })

  it('with full memory leads a suit nobody else holds once trump is gone', () => {
    // All trumps and the other five clubs fell: CK wins, nobody can follow or trump it.
    const s = leadState([C('C', 'K'), C('D', '9')], 0, {
      tricksPlayed: 4,
      tricksWon: [2, 2],
      log: [
        { t: 'card', seat: 0, card: C('H', '9') },
        { t: 'card', seat: 1, card: C('H', '10') },
        { t: 'card', seat: 2, card: C('H', 'J') },
        { t: 'card', seat: 3, card: C('H', 'Q') },
        { t: 'card', seat: 3, card: C('H', 'K') },
        { t: 'card', seat: 0, card: C('H', 'A') },
        { t: 'card', seat: 1, card: C('S', '9') },
        { t: 'card', seat: 2, card: C('C', 'A') },
        { t: 'card', seat: 0, card: C('C', '10') },
        { t: 'card', seat: 1, card: C('C', 'J') },
        { t: 'card', seat: 2, card: C('C', 'Q') },
        { t: 'card', seat: 3, card: C('C', '9') },
        { t: 'card', seat: 2, card: C('S', 'Q') },
        { t: 'card', seat: 3, card: C('S', 'A') },
        { t: 'card', seat: 0, card: C('S', 'K') },
        { t: 'card', seat: 1, card: C('S', '10') },
      ],
    })
    expect(botAction(s, 1, smart, 'hard')).toEqual({ type: 'play', seat: 1, card: C('C', 'K') })
    // Without the suit count the other levels lead low.
    for (const level of ['easy', 'normal'] as const) {
      expect(botAction(s, 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
    }
  })

  it('the bidder with many trumps pulls with the trump ace', () => {
    const hand = [C('H', 'A'), C('H', 'K'), C('H', 'Q'), C('H', '9'), C('S', 'A'), C('D', '9')]
    for (const level of LEVELS) {
      expect(botAction(leadState(hand, 1), 1, smart, level)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
    }
  })
})

describe('bot dealer choice', () => {
  const chooseState = (first: Card, second: Card, over: Partial<State> = {}) =>
    playingState({
      phase: 'DEALER_CHOICE',
      dealer: 0,
      turned: { first, second, secondUp: true },
      ...over,
    })

  it('two low cards of the same suit → usually pass', () => {
    const s = chooseState(C('H', '9'), C('H', '10'))
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: null })
    expect(botAction(s, 0, smart)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })

  it('same suit with a real card → almost always go', () => {
    const s = chooseState(C('H', 'A'), C('H', '10'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })

  it('different suits with an ace → sometimes go on the ace', () => {
    const s = chooseState(C('H', 'A'), C('S', '9'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: null })
  })

  it('different weak suits → pass', () => {
    const s = chooseState(C('H', 'Q'), C('S', '10'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: null })
  })

  it('always goes when a level-2 win ends the match', () => {
    const s = chooseState(C('H', 'Q'), C('S', '10'), { lines: [2, 13] })
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })
})

describe('bot levels', () => {
  it('easy keeps the bid thresholds from before the tuning', () => {
    // 12.5 rated for hearts: over easy's 11 on the 1st card, under the tuned 14.5.
    const s = bidState([C('H', 'A'), C('H', 'K'), C('H', '9'), C('D', 'K'), C('C', '10'), C('C', '9')])
    expect(botAction(s, 1, never, 'easy')).toEqual({ type: 'bid', seat: 1, play: true })
    expect(botAction(s, 1, never, 'normal')).toEqual({ type: 'bid', seat: 1, play: false })
    expect(botAction(s, 1, never, 'hard')).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('easy ignores knijpen', () => {
    const s = bidState(TRASH, { lines: [2, 13] })
    expect(botAction(s, 1, smart, 'easy')).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('easy never asks troefke, even with a strong trump hand', () => {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = [C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')]
    const s = playingState({ bidder: 1, turn: 3, leader: 3, trickAcks: [3], hands })
    expect(botAction(s, 1, smart, 'easy')).toEqual({ type: 'ack', seat: 1 })
  })

  it('easy dealer keeps the plain 70% rule', () => {
    const s = playingState({
      phase: 'DEALER_CHOICE',
      dealer: 0,
      turned: { first: C('H', 'A'), second: C('H', '10'), secondUp: true },
    })
    // rand 0.8: easy passes (>0.7), normal goes (<0.9).
    expect(botAction(s, 0, () => 0.8, 'easy')).toEqual({ type: 'choose', seat: 0, suit: null })
    expect(botAction(s, 0, () => 0.8, 'normal')).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })

  it('normal counts trumps and leads the boss; easy has no memory', () => {
    // Trick 1: HA fell under a spade lead, won by seat2 (team0) — no sweep.
    const hands: Card[][] = [[], [], [], []]
    hands[1] = [C('H', 'K'), C('S', '9'), C('D', '9'), C('C', '9'), C('C', '10')]
    const s = playingState({
      bidder: 1,
      turn: 1,
      tricksPlayed: 1,
      tricksWon: [1, 0],
      hands,
      log: [
        { t: 'card', seat: 0, card: C('S', '9') },
        { t: 'card', seat: 3, card: C('S', '10') },
        { t: 'card', seat: 2, card: C('H', 'A') },
        { t: 'card', seat: 1, card: C('S', 'J') },
        { t: 'trick', seat: 2 },
      ],
    })
    // HA is gone, so HK is boss — normal pulls it; easy assumes HA is still out.
    expect(botAction(s, 1, smart, 'normal')).toEqual({ type: 'play', seat: 1, card: C('H', 'K') })
    expect(botAction(s, 1, smart, 'easy')).toEqual({ type: 'play', seat: 1, card: C('S', '9') })
  })
})

describe('bot packet lift', () => {
  /** Packet sizes a bot picks over many rolls. */
  const picks = (s: State, seat: number) =>
    new Set(
      Array.from({ length: 200 }, (_, i) => {
        const a = botAction(s, seat, seededRandom(i + 1))
        if (a.type !== 'draw' && a.type !== 'cut') throw new Error(a.type)
        return a.n
      }),
    )

  it('lifts a valid packet in the dealer draw, for both teams', () => {
    let s = apply(createMatch(3), { type: 'start', seat: 0 })
    const a = picks(s, 0)
    expect(Math.min(...a)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...a)).toBeLessThanOrEqual(16)
    expect(a.size).toBeGreaterThan(5)
    s = apply(s, { type: 'draw', seat: 0, n: 12 })
    const b = picks(s, 1)
    expect(Math.min(...b)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...b)).toBeLessThanOrEqual(8)
  })

  it('lifts a valid packet in the cut', () => {
    const s = playingState({ phase: 'CUTTING', dealer: 2 })
    const c = picks(s, 1)
    expect(Math.min(...c)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...c)).toBeLessThanOrEqual(20)
    expect(c.size).toBeGreaterThan(5)
  })
})
