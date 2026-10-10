import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { arrangeHand, cardKey, moveCard } from '../src/lib/prefs'
import { C, memoryStore } from './helpers'

const hand = [C('H', '9'), C('S', 'K'), C('H', 'A'), C('S', '9'), C('D', 'J'), C('H', '10')]
const keys = (cs: ReturnType<typeof C>[]) => cs.map(cardKey)

describe('arrangeHand', () => {
  // H and D are red: with three suits the black S goes between them.
  test('high: by suit, high to low', () => {
    expect(keys(arrangeHand(hand, 'high', []))).toEqual(['HA', 'H10', 'H9', 'SK', 'S9', 'DJ'])
  })

  test('low: by suit, low to high', () => {
    expect(keys(arrangeHand(hand, 'low', []))).toEqual(['H9', 'H10', 'HA', 'S9', 'SK', 'DJ'])
  })

  const suitsOf = (cs: ReturnType<typeof C>[]) => [...new Set(cs.map((c) => c.s))].join('')
  const ofSuits = (suits: string) => [...suits].map((s) => C(s as 'S', '9'))

  test('four suits alternate black and red: S H C D', () => {
    const four = [C('D', 'A'), C('C', 'K'), C('H', 'Q'), C('S', 'J')]
    expect(suitsOf(arrangeHand(four, 'high', []))).toBe('SHCD')
    expect(suitsOf(arrangeHand(four, 'low', []))).toBe('SHCD')
  })

  test.each([
    ['SHD', 'HSD'],
    ['SHC', 'SHC'],
    ['SDC', 'SDC'],
    ['HDC', 'HCD'],
  ])('three suits %s: no two of one colour touch (%s)', (suits, want) => {
    expect(suitsOf(arrangeHand(ofSuits(suits), 'high', []))).toBe(want)
    expect(suitsOf(arrangeHand(ofSuits(suits), 'low', []))).toBe(want)
  })

  test.each([
    ['DS', 'SD'],
    ['CS', 'SC'],
    ['DH', 'HD'],
    ['C', 'C'],
  ])('two suits or one suit keep the base order: %s -> %s', (suits, want) => {
    expect(suitsOf(arrangeHand(ofSuits(suits), 'high', []))).toBe(want)
    expect(suitsOf(arrangeHand(ofSuits(suits), 'low', []))).toBe(want)
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

describe('saved preferences', () => {
  // A fresh module per test: the stores load their saved value on import.
  const fresh = async (saved: Record<string, string> = {}) => {
    const store = memoryStore()
    for (const [k, v] of Object.entries(saved)) store.setItem(k, v)
    vi.resetModules()
    vi.stubGlobal('localStorage', store)
    return { store, prefs: await import('../src/lib/prefs') }
  }

  afterEach(() => vi.unstubAllGlobals())

  test('without saved values: Dutch, normal bots, no name, no sort mode', async () => {
    const { store, prefs } = await fresh()
    expect(get(prefs.lang)).toBe('nl')
    expect(get(prefs.botLevel)).toBe('normal')
    expect(get(prefs.playerName)).toBe('')
    expect(get(prefs.sortMode)).toBeNull()
    expect(store.getItem('koejon-lang')).toBeNull()
  })

  test('the language survives a reload', async () => {
    const first = await fresh()
    first.prefs.lang.set('en')
    expect(first.store.getItem('koejon-lang')).toBe('en')
    const second = await fresh({ 'koejon-lang': 'en' })
    expect(get(second.prefs.lang)).toBe('en')
  })

  test('values under the existing keys still load', async () => {
    const { prefs } = await fresh({
      'koejon-name': 'Jef',
      'koejon-bot-level': 'hard',
      'koejon-sort-mode': 'low',
    })
    expect(get(prefs.playerName)).toBe('Jef')
    expect(get(prefs.botLevel)).toBe('hard')
    expect(get(prefs.sortMode)).toBe('low')
  })

  test('unknown saved values fall back', async () => {
    const { prefs } = await fresh({ 'koejon-lang': 'fr', 'koejon-bot-level': 'god', 'koejon-sort-mode': 'x' })
    expect(get(prefs.lang)).toBe('nl')
    expect(get(prefs.botLevel)).toBe('normal')
    expect(get(prefs.sortMode)).toBeNull()
  })

  test('the name is saved', async () => {
    const { store, prefs } = await fresh()
    prefs.playerName.set('Jef')
    expect(store.getItem('koejon-name')).toBe('Jef')
  })
})
