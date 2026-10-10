import { describe, expect, test } from 'vitest'
import { toPublic } from '../src/engine'
import { levelNames, localeOf, seatName, t } from '../src/lib/i18n'
import { replaySteps, parseKjn } from '../src/lib/kjn'
import { lastBids, showBids, showConfetti, troefkeBubble } from '../src/lib/table'
import { get } from 'svelte/store'
import { finishedMatch, playingState } from './helpers'

const deal = { t: 'deal', seat: 3 }
const pass = (seat: number) => ({ t: 'pass', seat })
const play = (seat: number) => ({ t: 'play-call', seat })

describe('lastBids', () => {
  test('keeps the latest bid of each seat since the deal', () => {
    const log = [pass(0), deal, pass(0), play(1), pass(2)]
    expect([...lastBids(log)]).toEqual([
      [2, 'pass'],
      [1, 'play'],
      [0, 'pass'],
    ])
  })

  test.each(['deal', 'first-dealer', 'all-pass', 'second-card', 'score', 'tied'])(
    '%s ends the look back',
    (stop) => {
      expect(lastBids([pass(0), { t: stop }, pass(1)]).has(0)).toBe(false)
      expect(lastBids([pass(0), { t: stop }, pass(1)]).get(1)).toBe('pass')
    },
  )

  test('a dealer pass counts as a pass', () => {
    expect(lastBids([{ t: 'dealer-pass', seat: 3 }]).get(3)).toBe('pass')
  })
})

describe('table state of a replayed match', () => {
  test('bid bubbles only show before the first card falls', () => {
    const steps = replaySteps(parseKjn(finishedMatch(2).kjn))
    for (const s of steps) {
      const pub = toPublic(s)
      if (showBids(pub) && pub.phase === 'PLAYING') {
        expect(pub.tricksPlayed).toBe(0)
        expect(pub.trick).toHaveLength(0)
      }
      if (troefkeBubble(pub, pub.bidder ?? -1)) expect(pub.troefkeAsked).toBe(true)
    }
  })
})

describe('showConfetti', () => {
  test('only the winning team sees the burst', () => {
    const pub = toPublic(playingState({ phase: 'GAME_OVER', winner: 0 }))
    expect(showConfetti(pub, 0)).toBe(true)
    expect(showConfetti(pub, 1)).toBe(false)
    expect(showConfetti(pub, 2)).toBe(true)
    expect(showConfetti(pub, 3)).toBe(false)
  })

  test('no burst before the match ends or on a draw', () => {
    const playing = toPublic(playingState({ winner: null }))
    expect(showConfetti(playing, 0)).toBe(false)
    const draw = toPublic(playingState({ phase: 'GAME_OVER', winner: null }))
    expect(showConfetti(draw, 0)).toBe(false)
  })
})

describe('i18n helpers', () => {
  test('level names, locale and seat name fallback', () => {
    const nl = get(t)
    expect(levelNames(nl).hard).toBe(nl.lvlHard)
    expect(localeOf('nl')).toBe('nl-BE')
    expect(localeOf('en')).toBe('en-GB')
    expect(seatName(nl, undefined, 1)).toBe(`${nl.player} 2`)
    expect(seatName(nl, '', 0)).toBe(`${nl.player} 1`)
    expect(seatName(nl, 'Wim', 0)).toBe('Wim')
  })
})
