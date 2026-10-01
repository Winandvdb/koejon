import { RANK_ORDER, trickPoints } from '../engine'
import type { PublicState, TrickCard } from '../engine'

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
  /** A player cannot follow suit and must pick something else. */
  forgot: ['Wat was ook alweer troef?'],
  /** A seat keeps the table waiting. */
  hurry: ['Geeft hem is een nen duw', "'Tis uw beurt he"],
  /** A team reaches 20 points mid-hand by feeding fat cards. */
  there: ['We zijn er al se'],
  /** A trick worth more than 10 points. */
  goodTrick: ['Amai das ne goeie slag!'],
  /** The defenders win their first trick — no kapot anymore. */
  noKapot: ['Hup se we zijn al niet kapot!'],
  /** Overtrumping right after the partner's ace got trumped. */
  notAce: ['Niet de aas van menne maat!'],
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

/** A bystander nags the seat that keeps everyone waiting. Timing lives in the UI. */
export function hurryQuote(slowSeat: number): { seat: number; text: string } {
  const h = Math.floor(Math.random() * 1e9)
  return {
    seat: (slowSeat + 1 + (h % 3)) % 4,
    text: QUOTES.hurry[h % QUOTES.hurry.length],
  }
}

/** Sayings that apply right now, derived purely from the shared public state. */
export function activeQuotes(pub: PublicState): TableQuote[] {
  const out: TableQuote[] = []
  const trump = pub.trump
  const hand = pub.handNumber

  // "Ik ga" just fell: the caller speaks until the first card lands.
  if (
    pub.phase === 'PLAYING' &&
    pub.bidder !== null &&
    pub.tricksPlayed === 0 &&
    pub.trick.length === 0
  ) {
    const h = hash(hand, 1)
    out.push({ key: `p${hand}`, seat: pub.bidder, text: QUOTES.play[h % QUOTES.play.length] })
  }

  // The opening lead just landed.
  if (
    pub.phase === 'PLAYING' &&
    pub.tricksPlayed === 0 &&
    pub.trick.length === 1 &&
    trump !== null &&
    pub.bidder !== null
  ) {
    const lead = pub.trick[0]
    const others = [1, 2, 3].map((i) => (lead.seat + i) % 4)
    if (lead.card.r === 'A') {
      const h = hash(hand, 5)
      out.push({ key: `a${hand}`, seat: others[h % 3], text: QUOTES.ace[0] })
    }
    // A defender — not the playing team — opens with trump.
    if (lead.card.s === trump && teamOf(lead.seat) !== teamOf(pub.bidder)) {
      const h = hash(hand, 6)
      out.push({ key: `d${hand}`, seat: teamSeat(teamOf(pub.bidder), h), text: QUOTES.showEm[0] })
    }
    if (lead.card.s !== trump && (lead.card.r === '9' || lead.card.r === '10')) {
      out.push({ key: `h${hand}`, seat: lead.seat, text: QUOTES.herman[0] })
    }
  }

  // A finished trick stays on the felt until the winner leads again.
  const lingering =
    (pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') &&
    pub.trick.length === 0 &&
    pub.lastTrick !== null

  // The cards currently visible: the open trick, or the finished one that
  // lingers — the 4th card resolves instantly, so position-4 moments only
  // ever show up in lastTrick. `shownNo` keeps keys stable across the resolve.
  const shown: TrickCard[] | null =
    pub.trick.length > 0 ? pub.trick : lingering ? pub.lastTrick : null
  const shownNo = pub.trick.length > 0 ? pub.tricksPlayed + 1 : pub.tricksPlayed

  if (shown !== null && trump !== null) {
    const led = shown[0].card.s
    if (led === trump) {
      // A non-trump under a trump lead proves the seat is out of trump —
      // the engine forces follow-suit, so they could not have held one.
      const voidTc = shown.find((tc, i) => i > 0 && tc.card.s !== trump)
      if (voidTc) {
        out.push({
          key: `v${hand}-${shownNo}-${voidTc.seat}`,
          seat: voidTc.seat,
          text: QUOTES.noTrump[0],
        })
      }
    } else {
      // A third suit under a plain lead proves a void in the led suit:
      // they cannot follow and must pick something else.
      const off = shown.find((tc, i) => i > 0 && tc.card.s !== led && tc.card.s !== trump)
      if (off) {
        out.push({
          key: `f${hand}-${shownNo}-${off.seat}`,
          seat: off.seat,
          text: QUOTES.forgot[0],
        })
      }
      // Overbuying the trump that just took the partner's ace.
      const lastTc = shown[shown.length - 1]
      if (shown.length >= 3 && lastTc.card.s === trump) {
        const partner = (lastTc.seat + 2) % 4
        const ai = shown.findIndex((tc) => tc.seat === partner && tc.card.r === 'A')
        const bought =
          ai >= 0 &&
          shown.some(
            (tc, i) =>
              i > ai &&
              i < shown.length - 1 &&
              teamOf(tc.seat) !== teamOf(lastTc.seat) &&
              tc.card.s === trump &&
              RANK_ORDER[tc.card.r] < RANK_ORDER[lastTc.card.r],
          )
        if (bought) {
          out.push({
            key: `o${hand}-${shownNo}-${lastTc.seat}`,
            seat: lastTc.seat,
            text: QUOTES.notAce[0],
          })
        }
      }
    }
  }

  if (lingering) {
    const last = pub.lastTrick!
    const wt = teamOf(pub.leader)

    // First trick of the hand for the winner's team while the opponents were
    // running the table (>= 2 tricks, all of them so far): kapot is broken.
    if (pub.tricksWon[wt] === 1 && pub.tricksWon[1 - wt] >= 2) {
      const h = hash(hand, pub.tricksPlayed, 2)
      out.push({
        key: `g${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(wt, h),
        text: QUOTES.gouwe[(h >> 4) % QUOTES.gouwe.length],
      })
    }
    // The defenders take their first trick: kapot is off the table.
    if (
      pub.bidder !== null &&
      wt !== teamOf(pub.bidder) &&
      pub.tricksWon[wt] === 1
    ) {
      const h = hash(hand, pub.tricksPlayed, 8)
      out.push({
        key: `k${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(wt, h),
        text: QUOTES.noKapot[0],
      })
    }
    // Same seat led trump two tricks running — pulling trump twice.
    const prev = pub.prevTrick
    if (
      trump !== null &&
      prev &&
      prev[0].seat === last[0].seat &&
      prev[0].card.s === trump &&
      last[0].card.s === trump
    ) {
      const h = hash(hand, pub.tricksPlayed, 7)
      out.push({
        key: `e${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(teamOf(last[0].seat), h),
        text: QUOTES.easy[0],
      })
    }
    // A fat trick: more than 10 card points.
    if (trickPoints(last) > 10) {
      const h = hash(hand, pub.tricksPlayed, 9)
      out.push({
        key: `s${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(wt, h),
        text: QUOTES.goodTrick[0],
      })
    }
    // The points pile crosses 20 mid-hand.
    for (const t of [0, 1]) {
      if (pub.points[t] >= 20) {
        const h = hash(hand, t, 10)
        out.push({ key: `2p${hand}-${t}`, seat: teamSeat(t, h), text: QUOTES.there[0] })
      }
    }
  }

  // A scored hand: the loser calls for a redeal; a winner that lost the
  // previous hand gloats. Previous-hand losers are visible in the marks:
  // the winner of hand N-1 crossed its own marks with batch N-1.
  const r = pub.lastResult
  if ((pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') && r && !r.draw) {
    const hl = hash(hand, 3)
    out.push({
      key: `l${hand}`,
      seat: teamSeat(1 - r.winnerTeam, hl),
      text: QUOTES.lost[hl % QUOTES.lost.length],
    })
    const lostLast = pub.marks.some(
      (m) => m.team === 1 - r.winnerTeam && m.crossed && m.batch === hand - 1,
    )
    if (lostLast) {
      const hr = hash(hand, 4)
      out.push({
        key: `r${hand}`,
        seat: teamSeat(r.winnerTeam, hr),
        text: QUOTES.revenge[(hr >> 4) % QUOTES.revenge.length],
      })
    }
  }

  return out
}
