import { describe, expect, it } from 'vitest'
import {
  apply,
  createMatch,
  pendingSeats,
  RANK_ORDER,
  trickWinnerIndex,
} from '../src/engine'
import type { State } from '../src/engine'
import { botAction, BOT_LEVELS, type BotLevel } from '../src/bots/bot'
import { seededRandom } from '../src/lib/seed'

const MATCHES = 60
const STEP_CAP = 20000

function runMatch(seed: number, level: BotLevel): { state: State; steps: number; hands: number } {
  let s = createMatch(seed)
  const rand = seededRandom(seed * 7919 + 13)
  let steps = 0
  let lastTrickSeen = 0

  while (s.phase !== 'GAME_OVER') {
    if (steps++ > STEP_CAP) throw new Error(`match ${seed} did not terminate`)
    const seats = pendingSeats(s)
    if (seats.length === 0) throw new Error(`match ${seed} stalled in ${s.phase}`)
    // Act with the first pending seat (others wait for the next step).
    const a = botAction(s, seats[0], rand, level)
    // No-underbuy invariant: a lower trump is never played while the seat can
    // follow the led suit and a trump already lies in the trick.
    if (a.type === 'play' && s.trick.length > 0) {
      const trump = s.trump!
      const led = s.trick[0].card.s
      const top = Math.max(
        0,
        ...s.trick.filter((tc) => tc.card.s === trump).map((tc) => RANK_ORDER[tc.card.r]),
      )
      const canFollow = s.hands[a.seat].some((c) => c.s === led)
      if (led !== trump && canFollow && top > 0) {
        const ok = a.card.s === led || (a.card.s === trump && RANK_ORDER[a.card.r] > top)
        expect(ok, `underbuy in match ${seed}`).toBe(true)
      }
    }
    s = apply(s, a)

    // Deal invariant: the deck rebuilt from the trick piles is still all 24 cards.
    if (a.type === 'deal') {
      expect(new Set(s.hands.flat().map((c) => c.s + c.r)).size, `deal in match ${seed}`).toBe(24)
    }
    // Per-trick invariant: the recorded winner really won the trick.
    if (s.lastTrick && s.lastTrick.length === 4 && s.tricksPlayed !== lastTrickSeen) {
      lastTrickSeen = s.tricksPlayed
      const w = s.lastTrick[trickWinnerIndex(s.lastTrick, s.trump!)].seat
      expect(w, `trick winner mismatch in match ${seed}`).toBe(s.turn)
    }
    // Hand invariant at scoring: all 6 tricks played, 40 points total.
    if (s.phase === 'SCORED') {
      expect(s.tricksPlayed).toBe(6)
      expect(s.tricksWon[0] + s.tricksWon[1]).toBe(6)
      expect(s.points[0] + s.points[1]).toBe(40)
      expect(s.lines[0]).toBeGreaterThanOrEqual(0)
      expect(s.lines[1]).toBeGreaterThanOrEqual(0)
    }
  }
  return { state: s, steps, hands: s.handNumber }
}

describe('bot-vs-bot simulation', () => {
  it.each(BOT_LEVELS)(`terminates ${MATCHES} complete matches of %s bots with all invariants`, (level) => {
    let totalHands = 0
    const wins = [0, 0]
    for (let seed = 1; seed <= MATCHES; seed++) {
      const { state, hands } = runMatch(seed, level)
      totalHands += hands
      expect(state.winner).not.toBeNull()
      wins[state.winner!]++
    }
    expect(totalHands).toBeGreaterThan(MATCHES) // every match played hands
    // sanity: both teams won some matches (bots are roughly symmetric)
    expect(wins[0]).toBeGreaterThan(0)
    expect(wins[1]).toBeGreaterThan(0)
  }, 120_000)
})
