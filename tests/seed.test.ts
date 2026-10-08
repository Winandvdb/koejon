import { describe, expect, test } from 'vitest'
import { SOLO_CODE } from '../src/lib/link-local'
import { demoSeed, hostRand, seededRandom } from '../src/lib/seed'

describe('?seed= for demo games', () => {
  test('reads a whole number seed when allowed', () => {
    expect(demoSeed('?seed=1', true)).toBe(1)
    expect(demoSeed('?room=SOLO&seed=42', true)).toBe(42)
  })

  test('is ignored when the build does not allow it (live builds)', () => {
    expect(demoSeed('?seed=1', false)).toBeNull()
  })

  test('ignores a missing or invalid seed', () => {
    for (const s of ['', '?seed=', '?seed=-1', '?seed=1.5', '?seed=abc', '?seed=1e3', '?seed=1234567890'])
      expect(demoSeed(s, true)).toBeNull()
  })

  test('only the solo host is seeded, never a multiplayer room', () => {
    expect(hostRand(1, SOLO_CODE)?.()).toBe(seededRandom(1)())
    expect(hostRand(1, 'ABCDEF')).toBeUndefined()
    expect(hostRand(null, SOLO_CODE)).toBeUndefined()
  })

  test('the same seed gives the same numbers, another seed others', () => {
    const take = (r: () => number) => Array.from({ length: 5 }, r)
    expect(take(seededRandom(7))).toEqual(take(seededRandom(7)))
    expect(take(seededRandom(7))).not.toEqual(take(seededRandom(8)))
    for (const x of take(seededRandom(7))) expect(x >= 0 && x < 1).toBe(true)
  })
})
