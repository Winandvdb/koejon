import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import type { GameDoc } from './kjn'
import { FirestoreGuestLink, FirestoreHostLink, HEARTBEAT_MS } from './link-firestore'
import type { HandDoc, Intent, PeerMsg, RoomDoc, RtcDoc } from './net-types'
import type { GuestEvents, GuestLink, HostLink, RoomUpdate } from './transport'

const rtcRef = (code: string, uid: string) => doc(db, 'rooms', code, 'rtc', uid)
const rtcCol = (code: string) => collection(db, 'rooms', code, 'rtc')

const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(viteEnv.VITE_TURN_URL
      ? [{ urls: viteEnv.VITE_TURN_URL, username: viteEnv.VITE_TURN_USER, credential: viteEnv.VITE_TURN_CRED }]
      : []),
  ],
}

/** `?p2p=off` / `?p2p=on` set it for this tab; the app rewrites the URL to
 *  `?room=…`, so the choice is kept in sessionStorage across refreshes. */
function p2pFlag(): string | null {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('p2p')
    if (fromUrl) sessionStorage.setItem('koejon-p2p', fromUrl)
    return sessionStorage.getItem('koejon-p2p')
  } catch {
    return null
  }
}

/** Off without WebRTC (Node, old browsers) or after `?p2p=off` in this tab. */
export const P2P_ENABLED = typeof RTCPeerConnection !== 'undefined' && p2pFlag() !== 'off'
if (typeof RTCPeerConnection !== 'undefined') console.info(`[p2p] ${P2P_ENABLED ? 'on' : 'off'}`)

/** This page's URL for a room (or none), keeping `p2p=off` visible so the
 *  forced fallback shows in the address bar and survives copy-paste. */
export function appUrl(room?: string): string {
  const q = new URLSearchParams()
  if (room) q.set('room', room)
  if (!P2P_ENABLED && typeof RTCPeerConnection !== 'undefined') q.set('p2p', 'off')
  const s = q.toString()
  return s ? `${location.pathname}?${s}` : location.pathname
}

/** No channel within this window counts as a failed attempt. */
const OPEN_TIMEOUT_MS = 10_000
/** After this many failed attempts in a row the guest stays on Firestore. */
const MAX_FAILS = 5

/** Non-trickle ICE: wait until the SDP holds every candidate (or give up waiting). */
function iceGathered(pc: RTCPeerConnection, ms = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState !== 'complete') return
      clearTimeout(t)
      resolve()
    })
  })
}

interface Peer {
  pc: RTCPeerConnection
  ch: RTCDataChannel | null
  offerTs: number
}

/**
 * Host for a shared room. Every guest with an open data channel gets state
 * straight from this tab; Firestore only carries the room for guests without
 * one, plus the lobby view (seats, options, started) that join and reclaim
 * read. The host's own session is fed in-tab through `guest`.
 */
export class P2PHostLink implements HostLink {
  readonly guest: GuestLink
  private inner: FirestoreHostLink
  private peers = new Map<string, Peer>()
  private rtcIds = new Set<string>()
  private local: GuestEvents | null = null
  private intentCb: ((uid: string, intent: Intent) => Promise<void>) | null = null
  private room: RoomDoc | null = null
  private lastUpdate: RoomUpdate | null = null
  private lastHands = new Map<string, HandDoc>()
  /** Lobby view as last written to Firestore. */
  private fsShape = ''
  private fsQueue: Promise<void> = Promise.resolve()
  private unsub: Unsubscribe | null = null

  constructor(
    private code: string,
    private uid: string,
    private p2p = P2P_ENABLED,
    heartbeatMs = HEARTBEAT_MS,
  ) {
    this.inner = new FirestoreHostLink(code, heartbeatMs)
    this.guest = {
      start: (ev) => {
        this.local = ev
        if (this.room) ev.room(this.room)
      },
      send: async (intent) => {
        await this.intentCb?.(this.uid, intent)
      },
      dispose: () => {
        this.local = null
      },
    }
  }

  async load(): Promise<RoomDoc | null> {
    this.room = await this.inner.load()
    this.local?.room(this.room)
    return this.room
  }

  onIntent(cb: (uid: string, intent: Intent) => Promise<void>): void {
    this.intentCb = cb
    this.inner.onIntent((uid, intent) => {
      // A guest only writes intent docs without an open channel: ours is dead
      // and unnoticed, so its answer must go through Firestore.
      const peer = this.peers.get(uid)
      if (peer && this.isOpen(uid)) this.drop(uid, peer)
      return cb(uid, intent)
    })
    if (!this.p2p) return
    this.unsub = onSnapshot(
      rtcCol(this.code),
      (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') continue
          const uid = ch.doc.id
          const d = ch.doc.data() as RtcDoc
          this.rtcIds.add(uid)
          if (!d.offer || d.answerFor === d.offerTs || this.peers.get(uid)?.offerTs === d.offerTs) continue
          this.answer(uid, d).catch((e) => console.warn('[p2p] answer failed', uid, e))
        }
      },
      (err) => console.error('[host] rtc listener error', err),
    )
  }

  private async answer(uid: string, d: RtcDoc): Promise<void> {
    const old = this.peers.get(uid)
    if (old) this.drop(uid, old)
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const peer: Peer = { pc, ch: null, offerTs: d.offerTs }
    this.peers.set(uid, peer)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(uid, peer)
    }
    pc.ondatachannel = (e) => {
      const ch = e.channel
      ch.onopen = () => {
        peer.ch = ch
        this.sendState(uid, ch)
        // This guest left the Firestore path: drop its hand doc there.
        this.syncFirestore().catch(() => {})
      }
      ch.onmessage = (m) => {
        const msg = JSON.parse(m.data as string) as PeerMsg
        if (msg.t === 'intent') void this.intentCb?.(uid, msg.intent)
      }
      ch.onclose = () => this.drop(uid, peer)
    }
    await pc.setRemoteDescription(JSON.parse(d.offer) as RTCSessionDescriptionInit)
    await pc.setLocalDescription(await pc.createAnswer())
    await iceGathered(pc)
    if (this.peers.get(uid) !== peer) return
    await updateDoc(rtcRef(this.code, uid), {
      answer: JSON.stringify(pc.localDescription),
      answerFor: d.offerTs,
    })
  }

  /** A closed channel puts the guest back on Firestore, which must be current. */
  private drop(uid: string, peer: Peer): void {
    if (this.peers.get(uid) !== peer) return
    this.peers.delete(uid)
    peer.pc.close()
    this.syncFirestore().catch(() => {})
  }

  private isOpen(uid: string): boolean {
    return this.peers.get(uid)?.ch?.readyState === 'open'
  }

  private sendState(uid: string, ch: RTCDataChannel): void {
    if (!this.room) return
    const msg: PeerMsg = { t: 'state', room: this.room, hand: this.lastHands.get(uid) ?? null }
    try {
      ch.send(JSON.stringify(msg))
    } catch {
      // Closing under us: the close handler moves this guest to Firestore.
    }
  }

  /** Seated humans other than the host without an open channel. */
  private fallbackUids(): string[] {
    return (this.room?.seats ?? []).flatMap((s) =>
      s && !s.bot && s.uid !== this.uid && !this.isOpen(s.uid) ? [s.uid] : [],
    )
  }

  async publish(update: RoomUpdate, hands: Map<string, HandDoc>): Promise<void> {
    this.room = { ...this.room!, ...update, heartbeat: Date.now() }
    this.lastUpdate = update
    this.lastHands = hands
    this.local?.state(this.room, hands.get(this.uid) ?? null)
    for (const [uid, p] of this.peers) {
      if (p.ch?.readyState === 'open') this.sendState(uid, p.ch)
    }
    await this.syncFirestore()
  }

  /** Serialized: two overlapping writes would trip the version fence. */
  private syncFirestore(): Promise<void> {
    const run = this.fsQueue.then(async () => {
      const u = this.lastUpdate
      if (!u) return
      const fallback = new Map<string, HandDoc>()
      for (const uid of this.fallbackUids()) {
        const h = this.lastHands.get(uid)
        if (h) fallback.set(uid, h)
      }
      const shape = JSON.stringify([u.seats, u.opts, u.pub?.phase === 'LOBBY'])
      if (fallback.size === 0 && shape === this.fsShape) return
      await this.inner.publish(u, fallback)
      this.fsShape = shape
    })
    this.fsQueue = run.catch(() => {})
    return run
  }

  heartbeat(): void {
    // Guests on a channel see the host directly; only Firestore guests need beats.
    if (this.fallbackUids().length > 0) this.inner.heartbeat()
  }

  async destroy(humanUids: string[]): Promise<void> {
    for (const [uid, p] of this.peers) this.drop(uid, p)
    // Before the room goes: the rules check the host against the room doc.
    await Promise.all([...this.rtcIds].map((id) => deleteDoc(rtcRef(this.code, id)).catch(() => {})))
    await this.inner.destroy(humanUids)
  }

  saveGame(id: string, game: GameDoc): Promise<void> {
    return this.inner.saveGame(id, game)
  }

  dispose(): void {
    this.unsub?.()
    this.unsub = null
    for (const p of this.peers.values()) p.pc.close()
    this.peers.clear()
    this.inner.dispose()
    this.local = null
  }
}

/**
 * Guest that prefers a data channel to the host and falls back to Firestore.
 * While the channel is open, Firestore room/hand updates are ignored — except
 * the room disappearing, which means the host closed it.
 */
export class P2PGuestLink implements GuestLink {
  private inner: FirestoreGuestLink
  private ev: GuestEvents | null = null
  private pc: RTCPeerConnection | null = null
  private ch: RTCDataChannel | null = null
  private offerTs = 0
  private fails = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private unsub: Unsubscribe | null = null
  private disposed = false
  /** Newest game seq shown, and the seq of the last Firestore room. The host
   *  skips Firestore writes while our channel is open, so after a drop that
   *  copy can be old: showing it would undo plays we already saw. */
  private shownSeq = 0
  private fsSeq = 0
  private fsHand: HandDoc | null | undefined

  constructor(
    private code: string,
    private uid: string,
  ) {
    this.inner = new FirestoreGuestLink(code, uid)
  }

  private get fsCurrent(): boolean {
    return !this.open && this.fsSeq >= this.shownSeq
  }

  private get open(): boolean {
    return this.ch?.readyState === 'open'
  }

  start(ev: GuestEvents): void {
    this.ev = ev
    this.inner.start({
      room: (r) => {
        if (r === null) return ev.room(r)
        this.fsSeq = r.seq ?? 0
        if (!this.fsCurrent) return
        this.shownSeq = this.fsSeq
        // A hand held back while this copy was old belongs to it now.
        if (this.fsHand !== undefined) ev.state(r, this.fsHand)
        else ev.room(r)
      },
      hand: (h) => {
        this.fsHand = h
        if (this.fsCurrent) ev.hand(h)
      },
      lost: () => {
        if (!this.open) ev.lost()
      },
      hostStale: (s) => {
        if (!this.open) ev.hostStale(s)
      },
    })
    this.unsub = onSnapshot(
      rtcRef(this.code, this.uid),
      (snap) => {
        const d = snap.data() as RtcDoc | undefined
        if (!d?.answer || d.answerFor !== this.offerTs || this.pc?.signalingState !== 'have-local-offer') return
        this.pc
          .setRemoteDescription(JSON.parse(d.answer) as RTCSessionDescriptionInit)
          .catch((e) => console.warn('[p2p] bad answer', e))
      },
      (err) => console.warn('[p2p] signaling listener error', err),
    )
    this.connect().catch((e) => {
      console.warn('[p2p] offer failed', e)
      this.scheduleRetry()
    })
  }

  private async connect(): Promise<void> {
    if (this.disposed) return
    this.close()
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const ch = pc.createDataChannel('game', { ordered: true })
    this.pc = pc
    this.ch = ch
    ch.onopen = () => {
      if (this.ch !== ch) return
      this.fails = 0
      this.ev?.hostStale(false)
    }
    ch.onmessage = (m) => {
      if (this.ch !== ch) return
      const msg = JSON.parse(m.data as string) as PeerMsg
      if (msg.t !== 'state') return
      // The channel is in order and straight from the host: always current.
      this.shownSeq = msg.room.seq ?? 0
      this.ev?.state(msg.room, msg.hand)
    }
    // While the channel is open the host sends no Firestore beats, so a lost
    // channel is the "host gone" signal. Firestore beats (the host resyncs
    // there when it sees us drop) or a reopened channel clear it again.
    ch.onclose = () => {
      if (this.ch !== ch) return
      this.ev?.hostStale(true)
      this.scheduleRetry()
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      const st = pc.connectionState
      // 'disconnected' can recover on its own; 'failed' needs a new offer.
      if (st === 'disconnected' || st === 'failed') this.ev?.hostStale(true)
      if (st === 'connected' && this.open) this.ev?.hostStale(false)
      if (st === 'failed') this.scheduleRetry()
    }
    await pc.setLocalDescription(await pc.createOffer())
    await iceGathered(pc)
    if (this.pc !== pc) return
    this.offerTs = Date.now()
    // merge: the old answer fields stay, and the rules let a guest touch only its offer.
    await setDoc(
      rtcRef(this.code, this.uid),
      { offer: JSON.stringify(pc.localDescription), offerTs: this.offerTs },
      { merge: true },
    )
    setTimeout(() => {
      if (this.ch === ch && !this.open) this.scheduleRetry()
    }, OPEN_TIMEOUT_MS)
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retry) return
    this.close()
    if (++this.fails > MAX_FAILS) {
      console.warn('[p2p] giving up, staying on Firestore')
      return
    }
    this.retry = setTimeout(
      () => {
        this.retry = null
        this.connect().catch((e) => {
          console.warn('[p2p] offer failed', e)
          this.scheduleRetry()
        })
      },
      Math.min(30_000, 1000 * 2 ** this.fails),
    )
  }

  private close(): void {
    const { pc, ch } = this
    this.pc = null
    this.ch = null
    ch?.close()
    pc?.close()
  }

  send(intent: Intent): Promise<void> {
    if (this.ch && this.open) {
      this.ch.send(JSON.stringify({ t: 'intent', intent } satisfies PeerMsg))
      return Promise.resolve()
    }
    return this.inner.send(intent)
  }

  dispose(): void {
    this.disposed = true
    if (this.retry) clearTimeout(this.retry)
    this.unsub?.()
    this.close()
    this.inner.dispose()
    this.ev = null
  }
}
