/**
 * KJN/1: the archival record of one Koejonnen match (see README). It holds
 * the dealt cards and every decision, so it stays readable without the RNG or
 * engine build that produced it. Incompatible changes need a new format
 * version: KJN/1 records must keep parsing exactly as they do today.
 */
import { apply, createMatch } from '../engine'
import type { Action, Card, HandResult, Rank, State, Suit } from '../engine'

export const KJN_FORMAT = 'KJN/1'
/** Upper bound on the serialized text; the Firestore rules enforce the same. */
export const KJN_MAX_CHARS = 100_000

export const SEAT_KINDS = ['human', 'bot-easy', 'bot-normal', 'bot-hard', 'mixed'] as const
/** `mixed`: the seat switched between human and bot (or bot level) mid-match. */
export type SeatKind = (typeof SEAT_KINDS)[number]

export interface KjnBid {
  seat: number
  play: boolean
}

export interface KjnTrick {
  leader: number
  cards: Card[]
}

export interface KjnResult {
  playing: number
  points: [number, number]
  /** Lines crossed per team this hand. */
  crossed: [number, number]
  kapot: boolean
  koei: boolean
}

export interface KjnHand {
  dealer: number
  /** Per seat, in dealt order: the dealer's 6th and 5th cards are the turned ones. */
  deal: Card[][]
  /** First (face up) and second turned card. */
  turned: [Card, Card]
  /** Bidding round 1 and, when it was played, round 2. */
  auction: KjnBid[][]
  /** Dealer choice: a suit, null for pass; absent when the dealer did not choose. */
  choice?: Suit | null
  /** Null: everybody passed, the hand was thrown in. */
  contract: { bidder: number; trump: Suit; level: 1 | 2 } | null
  troefke: boolean
  tricks: KjnTrick[]
  result: KjnResult | null
}

export interface KjnMatch {
  format: typeof KJN_FORMAT
  app: string
  seats: SeatKind[]
  hands: KjnHand[]
  /** Set at GAME_OVER. */
  winner: number | null
  lines: [number, number] | null
}

/** What `games/{id}` holds: the record plus a few fields to filter on. */
export interface GameDoc {
  format: typeof KJN_FORMAT
  app: string
  seats: SeatKind[]
  winner: number
  hands: number
  kjn: string
}

export function newKjn(app: string, seats: SeatKind[]): KjnMatch {
  return {
    format: KJN_FORMAT,
    app: app.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'unknown',
    seats: [...seats],
    hands: [],
    winner: null,
    lines: null,
  }
}

const copy = (c: Card): Card => ({ s: c.s, r: c.r })

function toResult(r: HandResult): KjnResult {
  const crossed: [number, number] = [0, 0]
  crossed[r.winnerTeam] = r.erased
  return { playing: r.playingTeam, points: [r.points[0], r.points[1]], crossed, kapot: r.kapot, koei: r.koei }
}

/** Add one applied engine action (`prev` → `next`) to the record. */
export function recordAction(m: KjnMatch, prev: State, a: Action, next: State): void {
  if (a.type === 'deal') {
    m.hands.push({
      dealer: next.dealer,
      deal: next.hands.map((h) => h.map(copy)),
      turned: [copy(next.turned!.first), copy(next.turned!.second)],
      auction: [[]],
      contract: null,
      troefke: false,
      tricks: [],
      result: null,
    })
    return
  }
  const h = m.hands[m.hands.length - 1]
  if (!h) return
  if (a.type === 'bid') {
    const round = prev.phase === 'BIDDING_R1' ? 0 : 1
    ;(h.auction[round] ??= []).push({ seat: a.seat, play: a.play })
  } else if (a.type === 'choose') {
    h.choice = a.suit
  } else if (a.type === 'troefke') {
    h.troefke = true
  } else if (a.type === 'play') {
    if (prev.trick.length === 0) h.tricks.push({ leader: a.seat, cards: [] })
    h.tricks[h.tricks.length - 1].cards.push(copy(a.card))
  }
  if (next.phase === 'PLAYING' && prev.phase !== 'PLAYING') {
    h.contract = { bidder: next.bidder!, trump: next.trump!, level: next.level as 1 | 2 }
  }
  if (a.type === 'play' && (next.phase === 'SCORED' || next.phase === 'GAME_OVER')) {
    h.result = toResult(next.lastResult!)
  }
  if (next.phase === 'GAME_OVER') {
    m.winner = next.winner
    m.lines = [next.lines[0], next.lines[1]]
  }
}

// ---- canonical text ----

const cardStr = (c: Card) => c.s + (c.r === '10' ? 'T' : c.r)
const cardsStr = (cs: Card[]) => cs.map(cardStr).join(' ')
const bit = (b: boolean) => (b ? '1' : '0')

export function serializeKjn(m: KjnMatch): string {
  const out: string[] = []
  const tag = (name: string, value: string) => out.push(`[${name} "${value}"]`)
  tag('Format', m.format)
  tag('App', m.app)
  tag('Seats', m.seats.join(' '))
  if (m.winner !== null && m.lines) {
    tag('Winner', String(m.winner))
    tag('Lines', m.lines.join(' '))
  }
  m.hands.forEach((h, i) => {
    out.push('')
    tag('Hand', String(i + 1))
    tag('Dealer', String(h.dealer))
    tag('Deal', h.deal.map(cardsStr).join(' / '))
    tag('Turned', cardsStr(h.turned))
    tag('Auction', h.auction.map((r) => r.map((b) => `${b.seat}${b.play ? 'G' : 'P'}`).join(' ')).join(' / '))
    if (h.choice !== undefined) tag('Choice', h.choice ?? '-')
    tag('Contract', h.contract ? `${h.contract.bidder} ${h.contract.trump} ${h.contract.level}` : '-')
    if (h.contract) {
      tag('Troefke', bit(h.troefke))
      tag('Play', h.tricks.map((t) => `${t.leader} ${cardsStr(t.cards)}`).join(' / '))
    }
    if (h.result) {
      tag('Playing', String(h.result.playing))
      tag('Points', h.result.points.join(' '))
      tag('Crossed', h.result.crossed.join(' '))
      tag('Kapot', bit(h.result.kapot))
      tag('Koei', bit(h.result.koei))
    }
  })
  return out.join('\n') + '\n'
}

class KjnParseError extends Error {
  constructor(msg: string) {
    super(`KJN: ${msg}`)
    this.name = 'KjnParseError'
  }
}

const fail = (msg: string): never => {
  throw new KjnParseError(msg)
}

const RANK_IN: Record<string, Rank> = { '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }

function parseCard(t: string): Card {
  const r = RANK_IN[t.slice(1)]
  if (t.length !== 2 || !'SHDC'.includes(t[0]) || !r) fail(`bad card ${t}`)
  return { s: t[0] as Suit, r }
}

const parseCards = (v: string) => (v === '' ? [] : v.split(' ').map(parseCard))

function parseSeat(v: string): number {
  if (!/^[0-3]$/.test(v)) fail(`bad seat ${v}`)
  return Number(v)
}

function parseBit(v: string): boolean {
  if (v !== '0' && v !== '1') fail(`bad flag ${v}`)
  return v === '1'
}

function parsePair(v: string): [number, number] {
  const m = /^(\d+) (\d+)$/.exec(v) ?? fail(`bad pair ${v}`)
  return [Number(m[1]), Number(m[2])]
}

function parseSuit(v: string): Suit {
  if (!['S', 'H', 'D', 'C'].includes(v)) fail(`bad suit ${v}`)
  return v as Suit
}

/** Tags of one section, read in their fixed order. */
class Tags {
  private i = 0
  private list: [string, string][]
  constructor(block: string) {
    this.list = block.split('\n').map((line) => {
      const m = /^\[([A-Za-z]+) "([^"]*)"\]$/.exec(line) ?? fail(`bad line ${line}`)
      return [m[1], m[2]]
    })
  }
  take(name: string): string {
    const t = this.list[this.i]
    if (!t || t[0] !== name) fail(`expected ${name}`)
    this.i++
    return t[1]
  }
  opt(name: string): string | undefined {
    return this.list[this.i]?.[0] === name ? this.take(name) : undefined
  }
  end(): void {
    if (this.i !== this.list.length) fail(`unexpected ${this.list[this.i][0]}`)
  }
}

function parseHand(block: string, n: number): KjnHand {
  const t = new Tags(block)
  if (t.take('Hand') !== String(n)) fail(`hand ${n} out of order`)
  const dealer = parseSeat(t.take('Dealer'))
  const deal = t.take('Deal').split(' / ').map(parseCards)
  if (deal.length !== 4 || deal.some((d) => d.length !== 6)) fail(`hand ${n}: deal needs 4 × 6 cards`)
  if (new Set(deal.flat().map(cardStr)).size !== 24) fail(`hand ${n}: deal repeats a card`)
  const turned = parseCards(t.take('Turned'))
  const dh = deal[dealer]
  if (turned.length !== 2 || cardStr(turned[0]) !== cardStr(dh[5]) || cardStr(turned[1]) !== cardStr(dh[4]))
    fail(`hand ${n}: turned cards are not the dealer's last two`)
  const auction = t
    .take('Auction')
    .split(' / ')
    .map((r) =>
      (r === '' ? [] : r.split(' ')).map((b) => {
        const m = /^([0-3])([GP])$/.exec(b) ?? fail(`bad bid ${b}`)
        return { seat: Number(m[1]), play: m[2] === 'G' }
      }),
    )
  const choiceTag = t.opt('Choice')
  const c = t.take('Contract')
  let contract: KjnHand['contract'] = null
  if (c !== '-') {
    const m = /^([0-3]) ([SHDC]) ([12])$/.exec(c) ?? fail(`bad contract ${c}`)
    contract = { bidder: Number(m[1]), trump: m[2] as Suit, level: Number(m[3]) as 1 | 2 }
  }
  let troefke = false
  let tricks: KjnTrick[] = []
  if (contract) {
    troefke = parseBit(t.take('Troefke'))
    const p = t.take('Play')
    tricks = (p === '' ? [] : p.split(' / ')).map((tr) => {
      const [leader, ...cards] = tr.split(' ')
      return { leader: parseSeat(leader), cards: cards.map(parseCard) }
    })
  }
  let result: KjnResult | null = null
  const playing = t.opt('Playing')
  if (playing !== undefined) {
    result = {
      playing: Number(playing),
      points: parsePair(t.take('Points')),
      crossed: parsePair(t.take('Crossed')),
      kapot: parseBit(t.take('Kapot')),
      koei: parseBit(t.take('Koei')),
    }
    if (result.playing !== 0 && result.playing !== 1) fail(`bad team ${playing}`)
  }
  t.end()
  const hand: KjnHand = {
    dealer,
    deal,
    turned: [turned[0], turned[1]],
    auction,
    contract,
    troefke,
    tricks,
    result,
  }
  if (choiceTag !== undefined) hand.choice = choiceTag === '-' ? null : parseSuit(choiceTag)
  return hand
}

/** Parse a canonical KJN/1 text. Throws on anything else, a non-canonical spelling included. */
export function parseKjn(text: string): KjnMatch {
  if (!text.endsWith('\n')) fail('missing final newline')
  const [head, ...blocks] = text.slice(0, -1).split('\n\n')
  const t = new Tags(head)
  const format = t.take('Format')
  if (format !== KJN_FORMAT) fail(`unsupported format ${format}`)
  const app = t.take('App')
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(app)) fail(`bad app ${app}`)
  const seats = t.take('Seats').split(' ') as SeatKind[]
  if (seats.length !== 4 || seats.some((s) => !SEAT_KINDS.includes(s))) fail('bad seats')
  const w = t.opt('Winner')
  if (w !== undefined && w !== '0' && w !== '1') fail(`bad winner ${w}`)
  const winner = w === undefined ? null : Number(w)
  const lines = w === undefined ? null : parsePair(t.take('Lines'))
  t.end()
  const m: KjnMatch = { format: KJN_FORMAT, app, seats, hands: blocks.map((b, i) => parseHand(b, i + 1)), winner, lines }
  if (serializeKjn(m) !== text) fail('not in canonical form')
  return m
}

/** The `games/{id}` document for a finished match; null when unfinished or too large. */
export function gameDoc(m: KjnMatch): GameDoc | null {
  if (m.winner === null) return null
  const kjn = serializeKjn(m)
  if (kjn.length > KJN_MAX_CHARS) return null
  return { format: m.format, app: m.app, seats: [...m.seats], winner: m.winner, hands: m.hands.length, kjn }
}

const sameResult = (r: HandResult, k: KjnResult) => {
  const crossed = [0, 0]
  crossed[r.winnerTeam] = r.erased
  return (
    r.playingTeam === k.playing &&
    r.points[0] === k.points[0] &&
    r.points[1] === k.points[1] &&
    crossed[0] === k.crossed[0] &&
    crossed[1] === k.crossed[1] &&
    r.kapot === k.kapot &&
    r.koei === k.koei
  )
}

/**
 * Plays a record through the engine from its dealt cards only (no seed) and
 * returns the final state. Throws when a move is illegal or a recorded result
 * differs: `games` is open to any signed-in client, so analysis keeps only
 * records that pass this.
 */
export function replayKjn(m: KjnMatch): State {
  return runKjn(m, () => {})
}

/**
 * The engine state after each recorded action: the deal, each bid, the
 * dealer choice, troefke and each card (the last card ends the hand).
 * Trick acknowledgements are folded into the next card. Throws like `replayKjn`.
 */
export function replaySteps(m: KjnMatch): State[] {
  const steps: State[] = []
  runKjn(m, (s) => steps.push(s))
  return steps
}

function runKjn(m: KjnMatch, step: (s: State) => void): State {
  let s = createMatch(0)
  const act = (a: Action) => {
    s = apply(s, a)
    step(s)
  }
  m.hands.forEach((h, i) => {
    const n = i + 1
    const lead = (h.dealer + 1) % 4
    s = {
      ...s,
      phase: 'BIDDING_R1',
      handNumber: s.handNumber + 1,
      dealer: h.dealer,
      dealerDraw: null,
      hands: h.deal.map((d) => d.map(copy)),
      turned: { first: h.turned[0], second: h.turned[1], secondUp: false },
      trump: null,
      level: 0,
      bidder: null,
      bidIndex: 0,
      turn: lead,
      leader: lead,
      trick: [],
      lastTrick: null,
      prevTrick: null,
      trickAcks: [lead],
      troefkeAsked: false,
      tricksPlayed: 0,
      tricksWon: [0, 0],
      points: [0, 0],
      piles: [[], []],
      log: [...s.log, { t: 'deal', seat: h.dealer, card: h.turned[0] }],
    }
    step(s)
    for (const b of h.auction.flat()) act({ type: 'bid', ...b })
    if (h.choice !== undefined) act({ type: 'choose', seat: h.dealer, suit: h.choice })
    if (!h.contract) {
      if (s.phase !== 'CUTTING' || h.result) fail(`hand ${n}: not a passed hand`)
      return
    }
    const c = h.contract
    if (s.bidder !== c.bidder || s.trump !== c.trump || s.level !== c.level) fail(`hand ${n}: contract differs`)
    if (h.troefke) act({ type: 'troefke', seat: c.bidder })
    for (const t of h.tricks) {
      if (s.turn !== t.leader) fail(`hand ${n}: wrong leader`)
      for (const card of t.cards) {
        // Trick acknowledgements are not part of the notation.
        for (const seat of [0, 1, 2, 3]) if (!s.trickAcks.includes(seat)) s = apply(s, { type: 'ack', seat })
        act({ type: 'play', seat: s.turn, card })
      }
    }
    if (!h.result || !s.lastResult || !sameResult(s.lastResult, h.result)) fail(`hand ${n}: result differs`)
  })
  if (m.winner !== null) {
    if (s.phase !== 'GAME_OVER' || s.winner !== m.winner) fail('match result differs')
    if (s.lines[0] !== m.lines![0] || s.lines[1] !== m.lines![1]) fail('final lines differ')
  }
  return s
}

/** A finished match from untrusted text (a shared file); throws when it is not one. */
export function loadKjn(text: string): KjnMatch {
  if (text.length > KJN_MAX_CHARS) fail('too large')
  const m = parseKjn(text)
  if (m.winner === null) fail('unfinished match')
  replayKjn(m)
  return m
}

/** Reads a `.kjn` file in the browser only; a too large file is refused unread. */
export async function readKjnFile(file: Blob): Promise<KjnMatch> {
  if (file.size > KJN_MAX_CHARS) fail('too large')
  return loadKjn(await file.text())
}
