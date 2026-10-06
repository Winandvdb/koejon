import { describe, expect, test } from 'vitest'
import { arrangeHand, cardKey, moveCard } from '../src/lib/prefs'
import { C } from './helpers'

const hand = [C('H', '9'), C('S', 'K'), C('H', 'A'), C('S', '9'), C('D', 'J'), C('H', '10')]
const keys = (cs: ReturnType<typeof C>[]) => cs.map(cardKey)

describe('arrangeHand', () => {
  test('high: by suit, high to low', () => {
    expect(keys(arrangeHand(hand, 'high', []))).toEqual(['SK', 'S9', 'HA', 'H10', 'H9', 'DJ'])
  })

  test('low: by suit, low to high', () => {
    expect(keys(arrangeHand(hand, 'low', []))).toEqual(['S9', 'SK', 'H9', 'H10', 'HA', 'DJ'])
  })

  test('manual without an order keeps the deal order', () => {
    expect(arrangeHand(hand, 'manual', [])).toEqual(hand)
  })

  test('manual order is kept as cards leave the hand', () => {
    const order = ['DJ', 'H9', 'SK', 'HA', 'S9', 'H10']
    expect(keys(arrangeHand(hand, 'manual', order))).toEqual(order)
    const left = hand.filter((c) => cardKey(c) !== 'SK' && cardKey(c) !== 'DJ')
    expect(keys(arrangeHand(left, 'manual', order))).toEqual(['H9', 'HA', 'S9', 'H10'])
  })

  test('cards not in the manual order follow in deal order', () => {
    expect(keys(arrangeHand(hand, 'manual', ['HA', 'XX']))).toEqual(['HA', 'H9', 'SK', 'S9', 'DJ', 'H10'])
  })
})

describe('moveCard', () => {
  test('moves forward and backward', () => {
    expect(moveCard(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveCard(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
})
