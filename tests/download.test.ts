import { describe, expect, test } from 'vitest'
import { kjnFile } from '../src/lib/download'
import { parseKjn, replayKjn } from '../src/lib/kjn'
import { finishedMatch } from './helpers'

describe('kjnFile', () => {
  test('holds the KJN/1 text unchanged, and it replays', async () => {
    const { kjn } = finishedMatch(11)
    const file = kjnFile(kjn, new Date(2026, 9, 8, 21, 5))
    const text = await file.text()
    expect(text).toBe(kjn)
    expect(file.type).toBe('text/plain;charset=utf-8')
    expect(replayKjn(parseKjn(text)).phase).toBe('GAME_OVER')
  })

  test('is named koejon-<YYYY-MM-DD>-<HHmm>.kjn in local time', () => {
    expect(kjnFile('x', new Date(2026, 0, 3, 7, 9)).name).toBe('koejon-2026-01-03-0709.kjn')
    expect(kjnFile('x', new Date(2026, 11, 31, 23, 59)).name).toBe('koejon-2026-12-31-2359.kjn')
  })
})
