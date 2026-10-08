import type { Action, Card, PublicState } from '../engine'
import type { BotLevel } from '../bots/bot'

export interface SeatInfo {
  uid: string
  name: string
  bot: boolean
  /** Bot difficulty; absent means 'normal'. */
  botLevel?: BotLevel
}

/** Host-controlled table display options; guests inherit them. */
export interface RoomOpts {
  /** Trump suit, level, multiplier and playing team on the table. */
  info: boolean
  /** Running points and trick counts. */
  score: boolean
}

export const DEFAULT_ROOM_OPTS: RoomOpts = { info: true, score: false }

/** A table quote the host decided to show, carried on the room so every
 *  client displays the same line at the same moment. */
export interface QuoteEvent {
  /** Monotonic counter per room; clients dedup on it. */
  n: number
  seat: number
  text: string
  /** Host clock, epoch ms. Clients skip entries that are too old. */
  at: number
}

export interface RoomDoc {
  code: string
  hostUid: string
  seats: (SeatInfo | null)[]
  pub: PublicState | null
  version: number
  /** Game state counter, the same on every path (unlike the Firestore doc's
   *  `version`). Guests never show a lower one than they already showed. */
  seq?: number
  /** Host heartbeat, epoch ms. Clients flag "host left" when stale. */
  heartbeat: number
  opts?: RoomOpts
  /** Quotes fired this match, newest last. Kept short; reset on a new match. */
  quotes?: QuoteEvent[]
  /** Canonical KJN/1 text of the finished match; only set in GAME_OVER. */
  kjn?: string | null
}

/** rooms/{code}/hands/{uid} */
export interface HandDoc {
  /** null = masked (dealer may not look during bidding) */
  cards: Card[] | null
}

/** rooms/{code}/actions/{uid} — a player's pending intent. */
export type Intent =
  | { kind: 'join'; name: string }
  | { kind: 'leave' }
  | { kind: 'act'; action: Action }

export interface IntentDoc {
  intent: Intent
  ts: number
}

/** rooms/{code}/rtc/{uid} — WebRTC signaling; SDPs carry all ICE candidates. */
export interface RtcDoc {
  offer: string
  offerTs: number
  answer?: string
  /** The offerTs this answer belongs to. */
  answerFor?: number
}

/** Messages on the host↔guest data channel. */
export type PeerMsg =
  | { t: 'state'; room: RoomDoc; hand: HandDoc | null }
  | { t: 'intent'; intent: Intent }

export const BOT_UID_PREFIX = 'bot:'
