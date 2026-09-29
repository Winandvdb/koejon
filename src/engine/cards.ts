import type { Card, Rank, Suit, TrickCard } from './types'

export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const RANKS: Rank[] = ['9', '10', 'J', 'Q', 'K', 'A']

/** Trick rank strength, low to high: 9=1 .. A=6. */
export const RANK_ORDER: Record<Rank, number> = {
  '9': 1,
  '10': 2,
  J: 3,
  Q: 4,
  K: 5,
  A: 6,
}

export const RANK_POINTS: Record<Rank, number> = {
  '9': 0,
  '10': 0,
  J: 1,
  Q: 2,
  K: 3,
  A: 4,
}

export function fullDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r })
  return deck
}

export function sameCard(a: Card, b: Card): boolean {
  return a.s === b.s && a.r === b.r
}

export function cardEq(a: Card | null | undefined, b: Card | null | undefined): boolean {
  return !!a && !!b && sameCard(a, b)
}

/**
 * Index of the winning card in a trick. Highest trump wins;
 * without a trump, the highest card of the led suit wins.
 */
export function trickWinnerIndex(trick: TrickCard[], trump: Suit): number {
  const led = trick[0].card.s
  let best = 0
  let bestTrump = trick[0].card.s === trump
  let bestRank = RANK_ORDER[trick[0].card.r]
  for (let i = 1; i < trick.length; i++) {
    const c = trick[i].card
    const isTrump = c.s === trump
    if (isTrump && !bestTrump) {
      best = i
      bestTrump = true
      bestRank = RANK_ORDER[c.r]
    } else if (isTrump === bestTrump && c.s === (bestTrump ? trump : led) && RANK_ORDER[c.r] > bestRank) {
      best = i
      bestRank = RANK_ORDER[c.r]
    }
  }
  return best
}

export function trickPoints(trick: TrickCard[]): number {
  let p = 0
  for (const tc of trick) p += RANK_POINTS[tc.card.r]
  return p
}

export function cardName(c: Card): string {
  const names: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
  return `${names[c.s]}${c.r}`
}
