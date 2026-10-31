import { describe, expect, it } from 'vitest'
import { apply, createMatch, pendingSeats } from '../src/engine'
import type { Action } from '../src/engine'
import type { AlgorithmSpec } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { seededRandom } from '../src/lib/seed'

/**
 * Fingerprints of seeded matches, recorded before #90 added `inference` and
 * `policy`: without the option the search bots and the heuristic must take
 * the same actions and draw the same random numbers as before.
 */

const actionKey = (a: Action): string => {
  switch (a.type) {
    case 'play':
      return `p${a.seat}${a.card.s}${a.card.r}`
    case 'bid':
      return `b${a.seat}${a.play ? 1 : 0}`
    case 'choose':
      return `c${a.seat}${a.suit ?? '-'}`
    default:
      return `${a.type[0]}${a.seat}`
  }
}

/** FNV-1a over the text, as hex. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * Seats 0 and 2 play `spec` (bids with heuristic:hard), seats 1 and 3
 * heuristic:hard, for `steps` actions: the actions and the count of random
 * numbers drawn, hashed.
 */
function fingerprint(spec: AlgorithmSpec, seed: number, steps: number): string {
  const bot = createBot({ name: 'golden', rules: [{ use: spec }, { use: 'heuristic:hard' }] })
  const other = createBot('heuristic:hard')
  const base = seededRandom(seed)
  let draws = 0
  const rand = () => {
    draws++
    return base()
  }
  const keys: string[] = []
  let s = createMatch(seed)
  while (s.phase !== 'GAME_OVER' && keys.length < steps) {
    const seat = pendingSeats(s)[0]
    const a = (seat % 2 === 0 ? bot : other).decide(s, seat, rand)
    keys.push(actionKey(a))
    s = apply(s, a)
  }
  return `${hash(keys.join(' '))}/${keys.length}/${draws}`
}

const CASES: [string, AlgorithmSpec, number[], number, string][] = [
  [
    'heuristic:hard',
    'heuristic:hard',
    [1, 2, 3, 4, 5, 6, 7, 8],
    3000,
    'cfcae100/798/292 dd59c117/719/278 9e3415b1/653/219 3cd2c87c/736/272 b4458f6f/727/276 db011db3/566/216 edeac84e/675/252 e9c430be/516/188',
  ],
  [
    'heuristic:normal',
    'heuristic:normal',
    [1, 2, 3, 4, 5, 6, 7, 8],
    3000,
    '4541b7cc/653/240 958d21ba/545/203 c7d6bda6/743/273 f1616343/561/207 aed3dfba/685/246 1fb72733/745/279 bdf38612/373/136 d1d3f2c1/647/246',
  ],
  [
    'heuristic:easy',
    'heuristic:easy',
    [1, 2, 3, 4, 5, 6, 7, 8],
    3000,
    'ec88b80a/663/298 6f6bd472/758/327 5e973868/554/257 307a32f9/484/205 e8f880a7/734/337 6309b672/650/293 169886b7/545/255 4d7d64ab/506/223',
  ],
  ['pimc', { id: 'pimc', samples: 4, partnerSamples: 2 }, [5, 6], 250, '3db1ad4b/250/3436 4c206dd2/250/2777'],
  ['mcts', { id: 'mcts', iterations: 60, worlds: 3 }, [5], 150, '137a6069/150/19472'],
  ['ismcts', { id: 'ismcts', iterations: 60 }, [5], 150, '112ec942/150/53487'],
]

describe('without inference nothing changes (#90)', () => {
  for (const [name, spec, seeds, steps, expected] of CASES) {
    it(`${name} plays the recorded actions with the recorded random numbers`, () => {
      expect(seeds.map((seed) => fingerprint(spec, seed, steps)).join(' ')).toBe(expected)
    }, 60_000)
  }
})
