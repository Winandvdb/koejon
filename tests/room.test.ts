import { describe, expect, test } from 'vitest'
import type { Action } from '../src/engine'
import { actionKey } from '../src/lib/room'

describe('actionKey', () => {
  test('equal actions give the same key, whatever the key order', () => {
    const a: Action = { type: 'play', seat: 1, card: { s: 'H', r: 'A' } }
    const b = { card: { r: 'A', s: 'H' }, seat: 1, type: 'play' } as Action
    expect(actionKey(a)).toBe(actionKey(b))
  })

  test('different actions give different keys', () => {
    const play = (r: 'A' | 'K'): Action => ({ type: 'play', seat: 1, card: { s: 'H', r } })
    expect(actionKey(play('A'))).not.toBe(actionKey(play('K')))
    expect(actionKey({ type: 'ack', seat: 1 })).not.toBe(actionKey({ type: 'ack', seat: 2 }))
    expect(actionKey({ type: 'bid', seat: 1, play: true })).not.toBe(actionKey({ type: 'bid', seat: 1, play: false }))
  })

  test('nested fields count, also ones the old key list did not name', () => {
    const withOpt = (x: number) => ({ type: 'ack', seat: 0, opt: { deep: { x } } }) as unknown as Action
    expect(actionKey(withOpt(1))).not.toBe(actionKey(withOpt(2)))
    const reordered = { seat: 0, opt: { deep: { x: 1 } }, type: 'ack' } as unknown as Action
    expect(actionKey(withOpt(1))).toBe(actionKey(reordered))
  })
})
