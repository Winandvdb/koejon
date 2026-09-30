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

export interface RoomDoc {
  code: string
  hostUid: string
  seats: (SeatInfo | null)[]
  pub: PublicState | null
  version: number
  /** Host heartbeat, epoch ms. Clients flag "host left" when stale. */
  heartbeat: number
  opts?: RoomOpts
}

/** rooms/{code}/hands/{uid} */
export interface HandDoc {
  /** null = masked (dealer may not look during bidding) */
  cards: Card[] | null
}

/** rooms/{code}/hands/host — bot hands keyed by seat number. */
export interface HostHandsDoc {
  botHands: Record<number, Card[]>
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

export const BOT_UID_PREFIX = 'bot:'
