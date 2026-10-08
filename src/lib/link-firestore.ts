import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from './fs'
import { auth, db, signIn } from './firebase'
import type { GameDoc } from './kjn'
import type { HandDoc, Intent, IntentDoc, RoomDoc } from './net-types'
import type { GuestEvents, GuestLink, HostLink, RoomUpdate } from './transport'

export const roomRef = (code: string) => doc(db, 'rooms', code)
export const handRef = (code: string, uid: string) => doc(db, 'rooms', code, 'hands', uid)
export const actionRef = (code: string, uid: string) => doc(db, 'rooms', code, 'actions', uid)
export const actionsCol = (code: string) => collection(db, 'rooms', code, 'actions')
export const gameRef = (id: string) => doc(db, 'games', id)

/**
 * Store a finished match. The caller keeps `id` across retries, so a write
 * that lands twice hits the same doc and the second is denied (write-once).
 * No timeout: the SDK keeps a queued write, so a timeout would only start a
 * second upload next to it. Solo may still lack a uid when it started offline.
 */
export async function saveGame(id: string, game: GameDoc): Promise<void> {
  if (!auth.currentUser) await signIn()
  await setDoc(gameRef(id), game)
}

/** Three missed host beats (15 s each) before guests call the host gone. */
export const HEARTBEAT_MS = 15_000
const STALE_MS = 3 * HEARTBEAT_MS

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A hung write must not freeze a serialized queue forever. */
export const withTimeout = <T>(p: Promise<T>, ms = 10_000): Promise<T> =>
  Promise.race([
    p,
    delay(ms).then(() => {
      const e = new Error('firestore-write-timeout')
      ;(e as Error & { code?: string }).code = 'unavailable'
      throw e
    }),
  ])

/** Host over Firestore: room doc + one hand doc per human, intents as docs. */
export class FirestoreHostLink implements HostLink {
  private unsubs: Unsubscribe[] = []
  /** Hand doc JSON as last written, by uid — unchanged hands are not rewritten. */
  private lastHands = new Map<string, string>()
  private lastPublishAt = 0
  /** The doc's own version: a P2P host skips most publishes, so it trails the game's. */
  private version = 0

  constructor(
    private code: string,
    private heartbeatMs = HEARTBEAT_MS,
  ) {}

  async load(): Promise<RoomDoc | null> {
    const snap = await getDoc(roomRef(this.code))
    const room = snap.exists() ? (snap.data() as RoomDoc) : null
    this.version = room?.version ?? 0
    return room
  }

  onIntent(cb: (uid: string, intent: Intent) => Promise<void>): void {
    this.unsubs.push(
      onSnapshot(
        actionsCol(this.code),
        (snap) => {
          for (const ch of snap.docChanges()) {
            if (ch.type !== 'added' && ch.type !== 'modified') continue
            const ref = ch.doc.ref
            const { intent } = ch.doc.data() as IntentDoc
            // The delete tells the guest its outbox may send the next intent.
            void cb(ch.doc.id, intent).finally(() => withTimeout(deleteDoc(ref)).catch(() => {}))
          }
        },
        (err) => console.error('[host] actions listener error', err),
      ),
    )
  }

  async publish(room: RoomUpdate, hands: Map<string, HandDoc>): Promise<void> {
    const batch = writeBatch(db)
    batch.update(roomRef(this.code), { ...room, version: this.version + 1, heartbeat: Date.now() })
    const changed = new Map<string, string | null>()
    for (const [uid, hand] of hands) {
      const json = JSON.stringify(hand)
      if (this.lastHands.get(uid) === json) continue
      batch.set(handRef(this.code, uid), hand)
      changed.set(uid, json)
    }
    // A seat that turned bot (left, kicked) loses its hand doc.
    for (const uid of this.lastHands.keys()) {
      if (hands.has(uid)) continue
      batch.delete(handRef(this.code, uid))
      changed.set(uid, null)
    }
    // The rules reject a version that is not exactly +1, so a failed commit
    // stays retryable and a second host instance stays fenced out.
    await withTimeout(batch.commit())
    for (const [uid, json] of changed) {
      if (json === null) this.lastHands.delete(uid)
      else this.lastHands.set(uid, json)
    }
    this.version++
    this.lastPublishAt = Date.now()
  }

  heartbeat(): void {
    // Beats also from a hidden tab: skipping them told guests the host had
    // left while it was only in the background. A recent publish already
    // carried a fresh heartbeat.
    if (Date.now() - this.lastPublishAt >= this.heartbeatMs) {
      updateDoc(roomRef(this.code), { heartbeat: Date.now() }).catch(() => {})
    }
  }

  async destroy(humanUids: string[]): Promise<void> {
    const batch = writeBatch(db)
    for (const uid of humanUids) batch.delete(handRef(this.code, uid))
    batch.delete(roomRef(this.code))
    await batch.commit()
  }

  saveGame(id: string, game: GameDoc): Promise<void> {
    return saveGame(id, game)
  }

  dispose(): void {
    for (const u of this.unsubs) u()
    this.unsubs = []
  }
}

/** Guest over Firestore: listens to the room and own hand doc, sends intent docs. */
export class FirestoreGuestLink implements GuestLink {
  private unsubs: Unsubscribe[] = []
  private staleTimer: ReturnType<typeof setInterval> | null = null
  private lastBeat: number | null = null
  /** Intents queue behind the action doc: the next one is only written after
   *  the host has processed (deleted) the previous one, so rapid actions can
   *  never overwrite or be deleted unseen. */
  private outbox: { intent: Intent; resolve: () => void; reject: (e: unknown) => void }[] = []
  private sending = false
  private actionDocGone = false
  private disposed = false

  constructor(
    private code: string,
    private uid: string,
  ) {}

  start(ev: GuestEvents): void {
    const lost = (label: string) => (err: unknown) => {
      console.error(`[room] ${label} listener error`, err)
      ev.lost()
    }
    this.unsubs.push(
      onSnapshot(
        roomRef(this.code),
        (snap) => {
          const room = snap.exists() ? (snap.data() as RoomDoc) : null
          this.lastBeat = room?.heartbeat ?? null
          ev.room(room)
        },
        lost('room'),
      ),
      onSnapshot(
        handRef(this.code, this.uid),
        (snap) => ev.hand(snap.exists() ? (snap.data() as HandDoc) : null),
        lost('hand'),
      ),
      onSnapshot(
        actionRef(this.code, this.uid),
        (snap) => {
          this.actionDocGone = !snap.exists()
          void this.flush()
        },
        lost('action-doc'),
      ),
    )
    this.staleTimer = setInterval(() => {
      if (this.lastBeat !== null) ev.hostStale(Date.now() - this.lastBeat > STALE_MS)
    }, 5000)
  }

  send(intent: Intent): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) return reject(new Error('session-disposed'))
      this.outbox.push({ intent, resolve, reject })
      void this.flush()
    })
  }

  private async flush(): Promise<void> {
    if (this.sending) return
    while (!this.disposed && this.outbox.length > 0 && this.actionDocGone) {
      this.sending = true
      const item = this.outbox.shift()!
      // Mark the doc as present up front. The snapshot stream reports our own
      // write and then the host's delete in order, so it owns the flag again
      // from here — setting it after the await could clobber a delete that
      // already landed.
      this.actionDocGone = false
      try {
        await withTimeout(
          setDoc(actionRef(this.code, this.uid), {
            intent: item.intent,
            ts: Date.now(),
          } satisfies IntentDoc),
        )
        item.resolve()
      } catch (e) {
        this.actionDocGone = true // nothing was written
        item.reject(e)
      }
      this.sending = false
    }
  }

  dispose(): void {
    this.disposed = true
    for (const it of this.outbox) it.reject(new Error('session-disposed'))
    this.outbox = []
    for (const u of this.unsubs) u()
    this.unsubs = []
    if (this.staleTimer) clearInterval(this.staleTimer)
  }
}
