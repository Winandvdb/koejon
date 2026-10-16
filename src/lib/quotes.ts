import { partnerOf, RANK_ORDER, teamOf, trickPoints, trickWinnerIndex } from '../engine'
import type { PublicState, TrickCard } from '../engine'
import type { QuoteEvent } from './net-types'

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
  /** Someone just called play. `tried` answers the second line. */
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
  noTrump: ['Ik heb al den hele avond geen troef'],
  /** A defender opened the hand with trump. */
  showEm: ['Laat ze maar is zien'],
  /** The hand opens with a low card. */
  herman: ['Ik gaan een Hermanneke doen'],
  /** A player cannot follow suit and must pick something else. */
  forgot: ['Wat was ook alweer troef?'],
  /** A seat keeps the table waiting. */
  hurry: ['Geeft hem is nen duw', "'Tis uw beurt he", 'Wast weer audit opt werk vandaag?'],
  /** A team reaches 21 points mid-hand by feeding fat cards. */
  there: ['We zijn er al se'],
  /** A trick worth more than 10 points. */
  goodTrick: ['Amai das ne goeie slag!'],
  /** The defenders win their first trick — no kapot anymore. */
  noKapot: ['Hup se we zijn al niet kapot!'],
  /** Overtrumping right after the partner's ace got trumped. */
  notAce: ['Niet de aas van menne maat!'],
  /** A player leads again the suit that just won them the trick. */
  again: ['Dan zullen we dat nog eens proberen'],
  /** The speaker's team just lost a trick. */
  trickLost: ['Hier ben ik helemaal van slag van', 'Dat is een slag in het gezicht'],
  /** A team only reaches 21 points on the last trick. */
  madeIt: ['Wij zijn er nog denk', "'T is nog van ons, telt maar na"],
  /** A team still has not crossed off a single mark. */
  noMarks: ['Wanneer gaan de kaarten draaien?'],
  /** All players passed: the next hand counts double. */
  allPass: ['Rondje pas', 'De eerste zullen de tweede zijn', 'Wie onthoudt het dat het dubbel is?'],
  /** A hand is scored and the match goes on. */
  scored: ['Was dat dubbel of enkel?', 'Vergeet ge niet te vegen?', 'Hoeveel moeten we er nog?'],
  /** The match starts. */
  start: ['Succes allemaal, maar niet veel te veel he'],
  /** Small talk while the deck is cut. */
  chat: [
    'Ik zen vandaag om 6u opgestaan',
    'Doede gij volgende week ook mee?',
    'Wie is uwe vaste maat normaal?',
    'Van waar zijde gij?',
    'Van wie zijde gij er ene?',
  ],
  /** The winners of a kapot praise each other. */
  kapotWon: ['Ge weet het goed genoeg'],
  /** The losers of a kapot. */
  kapotLost: ['Niks tegen te doen'],
  /** A hand won by a narrow margin. */
  narrowWin: ['Dat was goed gespeeld'],
  /** The partner led a side ace and the opponents trumped it. */
  countTrump: ['Ge moet wel troef tellen he!', 'Telde gij eigenlijk wel?'],
  /** The partner trumped a trick that the speaker already had. */
  ownTrick: ['Allee voorwa doede dat nu', 'Allee ge weet nu toch datk dat heb'],
  /** "We gaan proberen" fired and the bidding team won the hand. */
  tried: ['We gaan proberen zegt ie dan'],
  /** Lost the hand after playing two aces or more. */
  goodCards: ['Ik had goei speelkaarten, maar kon niks doen'],
  /** The match is over: the losers congratulate the winners. */
  matchLost: [
    'Allee proficiat, wat drinkt gullie?',
    'Gullie wordt kermiskampioen',
    'Allemaal van den Herman geleerd zeker?',
    'Dju toch, de kaarten waren gedraaid',
  ],
  /** The match is over: the winners stay sporting. */
  matchWon: ['Goed gespeeld', 'Plezant matchke', 'Plezant boomke'],
} as const

/** Deterministic hash: the same state always gives the same speaker and line.
 *  Only the host's QuoteBook picks; clients show what it fired. */
function hash(...ns: number[]): number {
  let h = 0
  for (const n of ns) h = Math.imul(h ^ (n + 0x9e3779b9), 0x85ebca6b) >>> 0
  // Fold the high bits in: without it the low bits follow the low bits of
  // the inputs, so `% 4` would repeat every 4 hands.
  return (h ^ (h >>> 16)) >>> 0
}

/** A pseudo-random seat of `team` (its two seats are `team` and `team + 2`). */
const teamSeat = (team: number, h: number) => team + 2 * (h % 2)

/** A bystander nags the seat that keeps everyone waiting. `cool` marks seats
 *  that spoke too recently; null when every bystander is on cooldown. */
export function hurryQuote(
  slowSeat: number,
  rand: () => number = Math.random,
  cool?: (seat: number) => boolean,
): { seat: number; text: string } | null {
  const free = [1, 2, 3].map((i) => (slowSeat + i) % 4).filter((s) => !cool?.(s))
  if (free.length === 0) return null
  const seat = free[Math.floor(rand() * free.length)]
  return { seat, text: QUOTES.hurry[Math.floor(rand() * QUOTES.hurry.length)] }
}

/** A met condition produces a line only this often — table talk stays rare. */
const QUOTE_CHANCE = 0.5
/** A hand won with at most this many points was a close call. */
const NARROW_WIN = 22
/** One seat talks at most this often. */
export const QUOTE_SEAT_GAP_MS = 60_000

/**
 * Per-match quote bookkeeping, owned by the host: it turns the candidates of
 * `activeQuotes` into the few quotes that actually appear on the room. The
 * counters survive a reload through the host's storage.
 */
export class QuoteBook {
  /** Lines already spoken this match — a text never repeats, whoever said it. */
  private said = new Set<string>()
  /** Keys of the quotes fired this match — some lines answer an earlier one. */
  private fired = new Set<string>()
  /** Last time each seat spoke, epoch ms. */
  private spokeAt = [0, 0, 0, 0]
  /** Fired-quote counter; keeps climbing across matches so clients dedup. */
  private n = 0

  /** A fresh match: lines may be said again. */
  reset(): void {
    this.said.clear()
    this.fired.clear()
    this.spokeAt = [0, 0, 0, 0]
  }

  /** A seat is quiet while its last line is less than a minute old;
   *  0 means it never spoke. */
  private cooling(seat: number, now: number): boolean {
    return this.spokeAt[seat] !== 0 && now - this.spokeAt[seat] < QUOTE_SEAT_GAP_MS
  }

  /** At most one candidate fires per call: it must survive the chance roll,
   *  its line must be new this match and its seat quiet for a minute. */
  pick(pub: PublicState, now = Date.now(), rand: () => number = Math.random): QuoteEvent | null {
    const ok = activeQuotes(pub, this.fired).filter(
      (q) => !this.said.has(q.text) && !this.cooling(q.seat, now),
    )
    if (ok.length === 0 || rand() >= QUOTE_CHANCE) return null
    const q = ok[Math.floor(rand() * ok.length)]
    this.said.add(q.text)
    this.fired.add(q.key)
    this.spokeAt[q.seat] = now
    return { n: ++this.n, seat: q.seat, text: q.text, at: now }
  }

  /** A nag for a stalled seat: lines may repeat, the speaker still needs a
   *  quiet minute. */
  hurry(slowSeat: number, now = Date.now(), rand: () => number = Math.random): QuoteEvent | null {
    const q = hurryQuote(slowSeat, rand, (s) => this.cooling(s, now))
    if (!q) return null
    this.spokeAt[q.seat] = now
    return { n: ++this.n, seat: q.seat, text: q.text, at: now }
  }

  toJSON(): { said: string[]; fired: string[]; spokeAt: number[]; n: number } {
    return { said: [...this.said], fired: [...this.fired], spokeAt: this.spokeAt, n: this.n }
  }

  /** `fired` is missing in a save from an older build. */
  static fromJSON(d: { said: string[]; fired?: string[]; spokeAt: number[]; n: number }): QuoteBook {
    const b = new QuoteBook()
    b.said = new Set(d.said)
    b.fired = new Set(d.fired ?? [])
    b.spokeAt = d.spokeAt
    b.n = d.n
    return b
  }
}

/** The "Ik ga" line of a hand. */
const playLine = (hand: number) => QUOTES.play[hash(hand, 1) % QUOTES.play.length]

/** Sayings that apply right now, derived purely from the shared public state
 *  and `fired`, the keys of the quotes that already fired this match. */
export function activeQuotes(pub: PublicState, fired: ReadonlySet<string> = new Set()): TableQuote[] {
  const out: TableQuote[] = []
  const trump = pub.trump
  const hand = pub.handNumber

  // The boomke is done: a word from each side of the table. The host rolls
  // only once at the end, so these two do not share that roll with the
  // lines of the last hand.
  if (pub.phase === 'GAME_OVER' && pub.winner !== null) {
    const hl = hash(hand, 14)
    const hw = hash(hand, 15)
    return [
      {
        key: 'ml',
        seat: teamSeat(1 - pub.winner, hl),
        text: QUOTES.matchLost[(hl >>> 4) % QUOTES.matchLost.length],
      },
      {
        key: 'mw',
        seat: teamSeat(pub.winner, hw),
        text: QUOTES.matchWon[(hw >>> 4) % QUOTES.matchWon.length],
      },
    ]
  }

  // "Ik ga" just fell: the caller speaks until the first card lands.
  if (
    pub.phase === 'PLAYING' &&
    pub.bidder !== null &&
    pub.tricksPlayed === 0 &&
    pub.trick.length === 0
  ) {
    out.push({ key: `p${hand}`, seat: pub.bidder, text: playLine(hand) })
  }

  // The match starts. The first drawn card is the only thing in the public
  // state that differs per match, so the speaker changes with it.
  const drawn = pub.phase === 'DEALER_DRAW' ? pub.dealerDraw?.draws[0]?.card : undefined
  if (drawn) {
    const h = hash('SHDC'.indexOf(drawn.s), RANK_ORDER[drawn.r], 17)
    out.push({ key: 'b', seat: h % 4, text: QUOTES.start[0] })
  }

  if (pub.phase === 'CUTTING') {
    // Everybody passed: the next hand counts double.
    if (pub.log[pub.log.length - 1]?.t === 'all-pass') {
      const h = hash(hand, pub.lines[0], pub.lines[1], 18)
      out.push({
        key: `ap${hand}`,
        seat: h % 4,
        text: QUOTES.allPass[(h >>> 4) % QUOTES.allPass.length],
      })
    }
    // Small talk on one cut in four. The lines left vary the hash, else
    // every match would repeat the same talk at the same cuts.
    const h = hash(hand, pub.lines[0], pub.lines[1], 16)
    if (h % 4 === 0) {
      out.push({
        key: `c${hand}`,
        seat: (h >>> 2) % 4,
        text: QUOTES.chat[(h >>> 4) % QUOTES.chat.length],
      })
    }
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
    if (lead.card.s === trump && teamOf(lead.seat) !== teamOf(pub.bidder)) {
      const h = hash(hand, 6)
      out.push({ key: `d${hand}`, seat: teamSeat(teamOf(pub.bidder), h), text: QUOTES.showEm[0] })
    }
    if (lead.card.s !== trump && (lead.card.r === '9' || lead.card.r === '10')) {
      out.push({ key: `h${hand}`, seat: lead.seat, text: QUOTES.herman[0] })
    }
  }

  // The winner of the previous trick leads the same suit again — it worked
  // once, so it is worth another try. `leader` is that winner.
  if (pub.phase === 'PLAYING' && pub.trick.length === 1 && pub.lastTrick !== null) {
    const wonWith = pub.lastTrick.find((tc) => tc.seat === pub.leader)?.card.s
    if (wonWith !== undefined && pub.trick[0].card.s === wonWith) {
      out.push({
        key: `n${hand}-${pub.tricksPlayed}`,
        seat: pub.trick[0].seat,
        text: QUOTES.again[0],
      })
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
        const partner = partnerOf(lastTc.seat)
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
        text: QUOTES.gouwe[(h >>> 4) % QUOTES.gouwe.length],
      })
    }
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
    if (trickPoints(last) > 10) {
      const h = hash(hand, pub.tricksPlayed, 9)
      out.push({
        key: `s${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(wt, h),
        text: QUOTES.goodTrick[0],
      })
    }
    if (trump !== null && last[0].card.s !== trump) {
      // A side ace only loses to a trump: the leader forgot one was still out.
      if (last[0].card.r === 'A' && wt !== teamOf(last[0].seat)) {
        const h = hash(hand, pub.tricksPlayed, 19)
        out.push({
          key: `t${hand}-${pub.tricksPlayed}`,
          seat: partnerOf(last[0].seat),
          text: QUOTES.countTrump[(h >>> 4) % QUOTES.countTrump.length],
        })
      }
      // The winner trumped, as the last card, the trick that the partner
      // already had: with nobody left to play, the trump only took it away.
      const wi = last.findIndex((tc) => tc.seat === pub.leader)
      const pi = last.findIndex((tc) => tc.seat === partnerOf(pub.leader))
      if (
        wi === 3 &&
        last[wi].card.s === trump &&
        pi < wi &&
        trickWinnerIndex(last.slice(0, wi), trump) === pi
      ) {
        const h = hash(hand, pub.tricksPlayed, 20)
        out.push({
          key: `j${hand}-${pub.tricksPlayed}`,
          seat: last[pi].seat,
          text: QUOTES.ownTrick[(h >>> 4) % QUOTES.ownTrick.length],
        })
      }
    }
    // A loser of the trick grumbles.
    {
      const h = hash(hand, pub.tricksPlayed, 11)
      out.push({
        key: `x${hand}-${pub.tricksPlayed}`,
        seat: teamSeat(1 - wt, h),
        text: QUOTES.trickLost[(h >>> 4) % QUOTES.trickLost.length],
      })
    }
    for (const t of [0, 1]) {
      if (pub.points[t] >= 21) {
        const h = hash(hand, t, 10)
        out.push({ key: `2p${hand}-${t}`, seat: teamSeat(t, h), text: QUOTES.there[0] })
      }
    }
    // The last trick only just pushed a team past 20 — a narrow escape.
    if (pub.tricksPlayed === 6) {
      const tp = trickPoints(last)
      for (const t of [0, 1]) {
        if (pub.points[t] >= 21 && pub.points[t] - tp < 21) {
          const h = hash(hand, t, 12)
          out.push({
            key: `u${hand}-${t}`,
            seat: teamSeat(t, h),
            text: QUOTES.madeIt[(h >>> 4) % QUOTES.madeIt.length],
          })
        }
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
        text: QUOTES.revenge[(hr >>> 4) % QUOTES.revenge.length],
      })
    }
    const wt = r.winnerTeam
    if (r.kapot) {
      const h = hash(hand, 21)
      out.push({ key: `iw${hand}`, seat: teamSeat(wt, h), text: QUOTES.kapotWon[0] })
      out.push({ key: `il${hand}`, seat: teamSeat(1 - wt, h >>> 1), text: QUOTES.kapotLost[0] })
    } else if (r.points[wt] <= NARROW_WIN) {
      out.push({ key: `iz${hand}`, seat: teamSeat(wt, hash(hand, 22)), text: QUOTES.narrowWin[0] })
    }
    // "We gaan proberen" really fired, and the bidders made it.
    if (wt === r.playingTeam && fired.has(`p${hand}`) && playLine(hand) === QUOTES.play[1]) {
      out.push({ key: `z${hand}`, seat: teamSeat(1 - wt, hash(hand, 23)), text: QUOTES.tried[0] })
    }
    // Two aces or more and still lost: the cards were not to blame.
    const deal = pub.log.findLastIndex((e) => e.t === 'deal')
    const aces = [0, 0, 0, 0]
    for (const e of pub.log.slice(deal + 1)) {
      if (e.t === 'card' && e.card?.r === 'A') aces[e.seat!]++
    }
    const unlucky = [0, 1, 2, 3].find((s) => teamOf(s) !== wt && aces[s] >= 2)
    if (unlucky !== undefined) {
      out.push({ key: `3${hand}`, seat: unlucky, text: QUOTES.goodCards[0] })
    }
  }

  // Not at the end of the match: there is no boomke left to keep.
  if (pub.phase === 'SCORED') {
    const h = hash(hand, pub.lines[0], pub.lines[1], 24)
    out.push({
      key: `y${hand}`,
      seat: h % 4,
      text: QUOTES.scored[(h >>> 4) % QUOTES.scored.length],
    })
  }

  // A hand is scored and a team still has not crossed off one mark — it asks
  // when the cards will finally turn its way.
  if (pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') {
    for (const t of [0, 1]) {
      if (!pub.marks.some((m) => m.team === t && m.crossed)) {
        const h = hash(hand, t, 13)
        out.push({
          key: `w${hand}-${t}`,
          seat: teamSeat(t, h),
          text: QUOTES.noMarks[0],
        })
      }
    }
  }

  return out
}
