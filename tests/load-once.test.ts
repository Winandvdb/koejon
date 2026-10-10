import { expect, test, vi } from 'vitest'
import { finishedMatch } from './helpers'

const calls = vi.hoisted(() => ({ apply: 0 }))
vi.mock('../src/engine', async (orig) => {
  const real = await orig<typeof import('../src/engine')>()
  return {
    ...real,
    apply: (...args: Parameters<typeof real.apply>) => {
      calls.apply++
      return real.apply(...args)
    },
  }
})

const { loadKjn, parseKjn, replaySteps } = await import('../src/lib/kjn')

test('opening a replay runs the engine once', () => {
  const { kjn } = finishedMatch(3)
  calls.apply = 0
  replaySteps(parseKjn(kjn))
  const once = calls.apply
  expect(once).toBeGreaterThan(0)

  calls.apply = 0
  loadKjn(kjn)
  expect(calls.apply).toBe(once)
})
