import { describe, expect, it } from 'vitest'
import { clientState, toPublic } from '../src/engine'
import { C, dealtState } from './helpers'

describe('public-state privacy', () => {
  it('exposes no hands, rng state or seed', () => {
    const pub = toPublic(dealtState(42))
    expect(pub).not.toHaveProperty('hands')
    expect(pub).not.toHaveProperty('rng')
    expect(pub).not.toHaveProperty('seed')
    // Hand sizes are public, but only as counts.
    expect(pub.handCounts).toEqual([6, 6, 6, 6])
  })

  it('masks the second turned card until the dealer reveals it', () => {
    const s = dealtState(7)
    const pub = toPublic(s)
    expect(pub.turned!.secondUp).toBe(false)
    expect(pub.turned!.second).toBeNull()
    expect(pub.turned!.first).toEqual(s.turned!.first)
  })

  it('reveals the second turned card once secondUp', () => {
    const s = dealtState(7)
    s.turned!.secondUp = true
    const pub = toPublic(s)
    expect(pub.turned!.second).toEqual(s.turned!.second)
  })

  it('clientState fills only the own hand', () => {
    const pub = toPublic(dealtState(9))
    const cs = clientState(pub, 1, [C('S', '9')])
    expect(cs.hands[1]).toHaveLength(1)
    expect(cs.hands[0]).toHaveLength(0)
    expect(cs.hands[2]).toHaveLength(0)
    expect(cs.hands[3]).toHaveLength(0)
  })
})
