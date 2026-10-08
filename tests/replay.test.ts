import { describe, expect, test } from 'vitest'
import { addHistory, readHistory, removeHistory } from '../src/lib/history'
import { KJN_MAX_CHARS, loadKjn, parseKjn, readKjnFile, replayKjn, replaySteps, serializeKjn } from '../src/lib/kjn'
import { finishedMatch, memoryStore } from './helpers'

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
    const m = await readKjnFile(new Blob([kjn]))
    expect(serializeKjn(m)).toBe(kjn)
    expect(loadKjn(kjn)).toEqual(m)
  })

  test('a file saved with Windows line endings, a BOM or no final newline loads', () => {
    const m = loadKjn(kjn)
    expect(loadKjn(kjn.replace(/\n/g, '\r\n'))).toEqual(m)
    expect(loadKjn('\uFEFF' + kjn.trimEnd())).toEqual(m)
    expect(loadKjn(kjn + '\n\n')).toEqual(m)
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

describe('removeHistory', () => {
  test('removes one entry from this device', () => {
    const store = memoryStore()
    addHistory({ seat: 0, names: [], kjn: finishedMatch(1).kjn }, store)
    addHistory({ seat: 0, names: [], kjn: finishedMatch(2).kjn }, store)
    const [first, second] = readHistory(store)
    removeHistory(first.id, store)
    expect(readHistory(store)).toEqual([second])
  })
})
