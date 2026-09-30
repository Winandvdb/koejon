import type { PublicState } from '../engine'

export interface TableQuote {
  /** Stable id of this saying, so it fires once per moment. */
  key: string
  seat: number
  text: string
}

/** Table talk, grouped by the moment it belongs to. Kept in dialect. */
export const QUOTES = {
  /** Won a trick while the other team was on a kapot run. */
  gouwe: ['Da was ne gouwe!', 'Gouden slag!'],
  /** Someone just called play. */
  play: ["'Tzijn de goei!", 'We gaan proberen'],
  /** The hand is lost. */
  lost: ['De kaarten moeten draaien'],
  /** Won a hand straight after losing one. */
  revenge: ['Ze zijn gedraaid!', 'Den eerste is den tweede!'],
  /** The hand opens with an ace. */
  ace: ['Amai ge hebt er goei!'],
  /** The same seat led trump two tricks in a row. */
  easy: ['Zo ist gemakkelijk he'],
  /** A player just showed out of trump. */
  noTrump: ['Ik heb al hele avond geen troef'],
  /** A defender opened the hand with trump. */
  showEm: ['Laat ze maar is zien'],
  /** The hand opens with a low card. */
  herman: ['Ik gaan een Hermanneke doen'],
} as const

/** Deterministic hash — all clients pick the same speaker and line. */
function hash(...ns: number[]): number {
  let h = 0
  for (const n of ns) h = Math.imul(h ^ (n + 0x9e3779b9), 0x85ebca6b) >>> 0
  return h
}

/** A pseudo-random seat of `team` (its two seats are `team` and `team + 2`). */
const teamSeat = (team: number, h: number) => team + 2 * (h % 2)

const teamOf = (seat: number) => seat % 2

/** Sayings that apply right now, derived purely from the shared public state. */
export function activeQuotes(pub: PublicState): TableQuote[] {
  const out: TableQuote[] = []

  // "Ik ga" just fell: the caller speaks until the first card lands.
  if (
    pub.phase === 'PLAYING' &&
    pub.bidder !== null &&
    pub.tricksPlayed === 0 &&
    pub.trick.length === 0
  ) {
    const h = hash(pub.handNumber, 1)
    out.push({ key: `p${pub.handNumber}`, seat: pub.bidder, text: QUOTES.play[h % QUOTES.play.length] })
  }

  // The opening lead just landed.
  if (
    pub.phase === 'PLAYING' &&
    pub.tricksPlayed === 0 &&
    pub.trick.length === 1 &&
    pub.trump !== null &&
    pub.bidder !== null
  ) {
    const lead = pub.trick[0]
    const others = [1, 2, 3].map((i) => (lead.seat + i) % 4)
    if (lead.card.r === 'A') {
      const h = hash(pub.handNumber, 5)
      out.push({ key: `a${pub.handNumber}`, seat: others[h % 3], text: QUOTES.ace[0] })
    }
    // A defender — not the playing team — opens with trump.
    if (lead.card.s === pub.trump && teamOf(lead.seat) !== teamOf(pub.bidder)) {
      const h = hash(pub.handNumber, 6)
      out.push({ key: `d${pub.handNumber}`, seat: teamSeat(teamOf(pub.bidder), h), text: QUOTES.showEm[0] })
    }
    if (lead.card.s !== pub.trump && (lead.card.r === '9' || lead.card.r === '10')) {
      out.push({ key: `h${pub.handNumber}`, seat: lead.seat, text: QUOTES.herman[0] })
    }
  }

  // A non-trump under a trump lead proves the seat is out of trump — the
  // engine forces follow-suit, so they could not have held one.
  if (pub.phase === 'PLAYING' && pub.trump !== null && pub.trick.length >= 2) {
    const voidTc =
      pub.trick[0].card.s === pub.trump
        ? pub.trick.find((tc, i) => i > 0 && tc.card.s !== pub.trump)
        : undefined
    if (voidTc) {
      out.push({
        key: `v${pub.handNumber}-${pub.tricksPlayed}-${voidTc.seat}`,
        seat: voidTc.seat,
        text: QUOTES.noTrump[0],
      })
    }
  }

  // First trick of the hand for the winner's team while the opponents were
  // running the table (>= 2 tricks, all of them so far): kapot is broken.
  const lingering =
    (pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') &&
    pub.trick.length === 0 &&
    pub.lastTrick !== null
  if (lingering) {
    const wt = teamOf(pub.leader)
    if (pub.tricksWon[wt] === 1 && pub.tricksWon[1 - wt] >= 2) {
      const h = hash(pub.handNumber, pub.tricksPlayed, 2)
      out.push({
        key: `g${pub.handNumber}-${pub.tricksPlayed}`,
        seat: teamSeat(wt, h),
        text: QUOTES.gouwe[(h >> 4) % QUOTES.gouwe.length],
      })
    }
    // Same seat led trump two tricks running — pulling trump twice.
    const prev = pub.prevTrick
    const last = pub.lastTrick!
    if (
      pub.trump !== null &&
      prev &&
      prev[0].seat === last[0].seat &&
      prev[0].card.s === pub.trump &&
      last[0].card.s === pub.trump
    ) {
      const h = hash(pub.handNumber, pub.tricksPlayed, 7)
      out.push({
        key: `e${pub.handNumber}-${pub.tricksPlayed}`,
        seat: teamSeat(teamOf(last[0].seat), h),
        text: QUOTES.easy[0],
      })
    }
  }

  // A scored hand: the loser calls for a redeal; a winner that lost the
  // previous hand gloats. Previous-hand losers are visible in the marks:
  // the winner of hand N-1 crossed its own marks with batch N-1.
  const r = pub.lastResult
  if ((pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') && r && !r.draw) {
    const hl = hash(pub.handNumber, 3)
    out.push({
      key: `l${pub.handNumber}`,
      seat: teamSeat(1 - r.winnerTeam, hl),
      text: QUOTES.lost[hl % QUOTES.lost.length],
    })
    const lostLast = pub.marks.some(
      (m) => m.team === 1 - r.winnerTeam && m.crossed && m.batch === pub.handNumber - 1,
    )
    if (lostLast) {
      const hr = hash(pub.handNumber, 4)
      out.push({
        key: `r${pub.handNumber}`,
        seat: teamSeat(r.winnerTeam, hr),
        text: QUOTES.revenge[(hr >> 4) % QUOTES.revenge.length],
      })
    }
  }

  return out
}
