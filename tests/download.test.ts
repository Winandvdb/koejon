import { describe, expect, test } from 'vitest'
import { apply, createMatch, pendingSeats } from '../src/engine'
import { botAction } from '../src/bots/bot'
import { kjnFile } from '../src/lib/download'
import { newKjn, parseKjn, recordAction, replayKjn, serializeKjn } from '../src/lib/kjn'
import { mulberry } from './helpers'

function finishedKjn(seed: number): string {
  let s = createMatch(seed)
  const rand = mulberry(seed)
  const rec = newKjn('test', ['human', 'bot-normal', 'human', 'bot-normal'])
  while (s.phase !== 'GAME_OVER') {
    const a = botAction(s, pendingSeats(s)[0], rand)
    const next = apply(s, a)
    recordAction(rec, s, a, next)
    s = next
  }
  return serializeKjn(rec)
}

describe('kjnFile', () => {
  test('holds the KJN/1 text unchanged, and it replays', async () => {
    const kjn = finishedKjn(11)
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
