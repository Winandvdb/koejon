import { describe, expect, test } from 'vitest'
import { sameCard } from '../src/engine'
import { addHistory, readHistory } from '../src/lib/history'
import { KJN_MAX_CHARS, loadKjn, parseKjn, readKjnFile, replayKjn, replaySteps, serializeKjn } from '../src/lib/kjn'
import { replayMoves } from '../src/lib/replay'
import { finishedMatch, memoryStore } from './helpers'

describe('replayMoves', () => {
  test('groups every action per hand with its step, trick winners and own flags', () => {
    for (const seed of [3, 7]) {
      const { match, steps } = loadKjn(finishedMatch(seed).kjn)
      const my = seed % 4
      const hands = replayMoves(match, steps, my)
      expect(hands).toHaveLength(match.hands.length)
      expect(hands[0].start).toBe(0)
      expect(hands.at(-1)!.end).toBe(steps.length - 1)

      hands.forEach((h, i) => {
        const kh = match.hands[i]
        expect(h.n).toBe(i + 1)
        if (i > 0) expect(h.start).toBe(hands[i - 1].end + 1)
        expect(steps[h.start].handNumber).toBe(h.n)
        expect(steps[h.start].phase).toBe('BIDDING_R1')

        // Item count per hand.
        expect(h.bids).toHaveLength(kh.auction.flat().length + (kh.choice !== undefined ? 1 : 0) + (kh.troefke ? 1 : 0))
        expect(h.tricks).toHaveLength(kh.contract ? 6 : 0)
        for (const t of h.tricks) expect(t.items).toHaveLength(4)

        // Step per item: one after the other, from the deal to the end of the hand.
        const items = [...h.bids, ...h.tricks.flatMap((t) => t.items)]
        expect(items.map((x) => x.step)).toEqual(items.map((_, j) => h.start + 1 + j))
        expect(h.end).toBe(h.start + items.length)

        for (const x of items) {
          expect(x.own).toBe(x.seat === my)
          if (x.action.type === 'play') {
            const card = x.action.card
            expect(steps[x.step - 1].hands[x.seat].some((c) => sameCard(c, card))).toBe(true)
            expect(steps[x.step].hands[x.seat].some((c) => sameCard(c, card))).toBe(false)
          }
        }

        // Trick winners: the winner leads the next trick, and the counts match the engine.
        h.tricks.forEach((t, j) => {
          expect(t.items.filter((x) => x.winner).map((x) => x.seat)).toEqual([t.winner])
          if (j < 5) expect(h.tricks[j + 1].leader).toBe(t.winner)
        })
        if (kh.contract) expect(h.tricksWon).toEqual(steps[h.end].tricksWon)
        expect(h.lines).toEqual(steps[h.end].lines)
      })
    }
  })
})

describe('replaySteps', () => {
  test('gives the state after every recorded action and ends where replayKjn ends', () => {
    const seen = { passed: 0, level2: 0 }
    for (let seed = 1; seed <= 10; seed++) {
      const m = parseKjn(finishedMatch(seed).kjn)
      const steps = replaySteps(m)
      expect(steps.at(-1)).toEqual(replayKjn(m))
      expect(steps.at(-1)!.phase).toBe('GAME_OVER')

      // One step for the deal, each bid, the choice, troefke and each card.
      const actions = m.hands.reduce(
        (n, h) =>
          n +
          1 +
          h.auction.flat().length +
          (h.choice !== undefined ? 1 : 0) +
          (h.troefke ? 1 : 0) +
          h.tricks.reduce((k, t) => k + t.cards.length, 0),
        0,
      )
      expect(steps).toHaveLength(actions)

      m.hands.forEach((h, i) => {
        const hand = steps.filter((s) => s.handNumber === i + 1)
        expect(hand[0].phase).toBe('BIDDING_R1')
        expect(hand[0].hands).toEqual(h.deal)
        const end = hand.at(-1)!
        if (!h.contract) {
          seen.passed++
          expect(end.phase).toBe('CUTTING')
        } else {
          if (h.contract.level === 2) seen.level2++
          expect(['SCORED', 'GAME_OVER']).toContain(end.phase)
          expect(end.tricksPlayed).toBe(6)
        }
      })
    }
    expect(seen.passed).toBeGreaterThan(0)
    expect(seen.level2).toBeGreaterThan(0)
  }, 60_000)
})

describe('loading a match to replay', () => {
  const { kjn } = finishedMatch(7)

  test('a valid file loads', async () => {
    const { match } = await readKjnFile(new Blob([kjn]))
    expect(serializeKjn(match)).toBe(kjn)
    expect(loadKjn(kjn).match).toEqual(match)
  })

  test('a loaded match comes with its replay steps', () => {
    const { match, steps } = loadKjn(kjn)
    expect(steps).toEqual(replaySteps(match))
  })

  test('a file saved with Windows line endings, a BOM or no final newline loads', () => {
    const { match } = loadKjn(kjn)
    expect(loadKjn(kjn.replace(/\n/g, '\r\n')).match).toEqual(match)
    expect(loadKjn('\uFEFF' + kjn.trimEnd()).match).toEqual(match)
    expect(loadKjn(kjn + '\n\n').match).toEqual(match)
  })

  test('an invalid record is refused', async () => {
    await expect(readKjnFile(new Blob(['hello\n']))).rejects.toThrow()
    expect(() => loadKjn(kjn.replace('KJN/1', 'KJN/2'))).toThrow()
    // Parses, but the engine does not reproduce it.
    expect(() => loadKjn(kjn.replace(/\[Winner "(\d)"\]/, (_, w) => `[Winner "${1 - Number(w)}"]`))).toThrow()
  })

  test('an unfinished match is refused', () => {
    const m = parseKjn(kjn)
    expect(() => loadKjn(serializeKjn({ ...m, winner: null, lines: null }))).toThrow(/unfinished/)
  })

  test('a too large file is refused before it is read', async () => {
    let read = false
    const big = {
      size: KJN_MAX_CHARS + 1,
      text: async () => {
        read = true
        return kjn
      },
    } as unknown as Blob
    await expect(readKjnFile(big)).rejects.toThrow(/too large/)
    expect(read).toBe(false)
    expect(() => loadKjn(kjn + ' '.repeat(KJN_MAX_CHARS))).toThrow(/too large/)
  })
})
