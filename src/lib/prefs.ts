import { writable } from 'svelte/store'
import { RANK_ORDER } from '../engine'
import type { Card, Suit } from '../engine'

/** How the own hand is shown: by suit high→low, by suit low→high, or in the
 *  player's own (dragged) order. */
export type SortMode = 'high' | 'low' | 'manual'

export const SORT_MODES: SortMode[] = ['high', 'low', 'manual']
export const SORT_LABEL = { high: 'sortHigh', low: 'sortLow', manual: 'sortManual' } as const

// A new key: everyone gets the first-deal question once, also players who
// had the old on/off setting.
const KEY = 'koejon-sort-mode'

function load(): SortMode | null {
  try {
    const v = localStorage.getItem(KEY)
    return SORT_MODES.includes(v as SortMode) ? (v as SortMode) : null
  } catch {
    return null
  }
}

/** Per-player preference. null: not chosen yet, the table asks on the first deal. */
export const sortMode = writable<SortMode | null>(load())

sortMode.subscribe((v) => {
  if (v === null) return
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Preferences just won't persist.
  }
})

export const cardKey = (c: Card) => c.s + c.r

// Display order only, black and red alternate. The engine's SUITS stays as
// is: it fixes the deck order, so seeded deals and KJN replays stay the same.
const HAND_SUITS: Suit[] = ['S', 'H', 'C', 'D']
// Three suits, by the missing suit: the one suit of the other colour goes in
// the middle, so no two suits of one colour touch.
const THREE_SUITS: Record<Suit, Suit[]> = {
  S: ['H', 'C', 'D'],
  H: ['S', 'D', 'C'],
  C: ['H', 'S', 'D'],
  D: ['S', 'H', 'C'],
}

/** The suits in the hand, in display order. */
function suitOrder(hand: Card[]): Suit[] {
  const suits = HAND_SUITS.filter((s) => hand.some((c) => c.s === s))
  const missing = HAND_SUITS.filter((s) => !suits.includes(s))
  return suits.length === 3 ? THREE_SUITS[missing[0]] : suits
}

/** The hand in display order. In manual mode `order` (card keys) leads; cards
 *  not in it (a new hand) follow in deal order, and played cards just drop out. */
export function arrangeHand(hand: Card[], mode: SortMode | null, order: string[]): Card[] {
  if (mode === 'manual') {
    const pos = (c: Card) => {
      const i = order.indexOf(cardKey(c))
      return i < 0 ? order.length : i
    }
    return hand.map((c, i) => ({ c, i })).sort((a, b) => pos(a.c) - pos(b.c) || a.i - b.i).map((x) => x.c)
  }
  const dir = mode === 'low' ? 1 : -1
  const suits = suitOrder(hand)
  return [...hand].sort(
    (a, b) => suits.indexOf(a.s) - suits.indexOf(b.s) || dir * (RANK_ORDER[a.r] - RANK_ORDER[b.r]),
  )
}

/** Move the item at `from` to index `to`. */
export function moveCard(order: string[], from: number, to: number): string[] {
  const next = [...order]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
