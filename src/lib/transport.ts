import type { HandDoc, Intent, RoomDoc } from './net-types'

/** Three missed host beats (15 s each) before guests call the host gone. */
export const HEARTBEAT_MS = 15_000

/** What the host changes on every commit; the link adds its own heartbeat. */
export type RoomUpdate = Pick<RoomDoc, 'seats' | 'pub' | 'version' | 'seq' | 'opts' | 'quotes' | 'kjn'>

/** Host side of the wire: how state leaves the host and intents reach it. */
export interface HostLink {
  /** The room as last published, or null when it does not exist. */
  load(): Promise<RoomDoc | null>
  /** `cb` resolves once the intent is processed. */
  onIntent(cb: (uid: string, intent: Intent) => Promise<void>): void
  /** Publish a new room version plus every human seat's hand, keyed by uid.
   *  Rejects when it did not land, so the caller keeps the old version. */
  publish(room: RoomUpdate, hands: Map<string, HandDoc>): Promise<void>
  /** Called on a fixed tick; the link decides if a liveness signal is due. */
  heartbeat(): void
  /** Remove the room for everybody. */
  destroy(humanUids: string[]): Promise<void>
  dispose(): void
}

export interface GuestEvents {
  room(r: RoomDoc | null): void
  hand(h: HandDoc | null): void
  /** Room and own hand of one version, as one update: with `room` then
   *  `hand` the view shows the new room with the old hand in between. */
  state(r: RoomDoc, h: HandDoc | null): void
  /** Updates stopped (listener died, offline, quota). */
  lost(): void
  hostStale(stale: boolean): void
}

/** Guest side of the wire. The host's own session uses one too. */
export interface GuestLink {
  start(ev: GuestEvents): void
  send(intent: Intent): Promise<void>
  dispose(): void
}
