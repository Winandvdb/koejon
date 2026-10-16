import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMatch, toPublic } from '../src/engine'
import type { Card } from '../src/engine'
import { P2PGuestLink, P2PHostLink } from '../src/lib/link-p2p'
import type { PeerMsg, RoomDoc } from '../src/lib/net-types'
import { newRoomDoc, RoomSession } from '../src/lib/room'
import { DEAD_MS, PING_MS } from '../src/lib/transport'
import { C } from './helpers'

// Firestore stand-in, as in rollback.test.ts.
const fake = vi.hoisted(() => ({
  listeners: new Map<string, (snap: unknown) => void>(),
  /** Paths of hand docs the host wrote, in order. */
  handWrites: [] as string[],
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  onSnapshot: (ref: { path: string }, next: (snap: unknown) => void) => {
    fake.listeners.set(ref.path, next)
    return () => fake.listeners.delete(ref.path)
  },
  setDoc: async () => {},
  updateDoc: async () => {},
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => false }),
  writeBatch: () => ({
    update: () => {},
    set: (ref: { path: string }) => void fake.handWrites.push(ref.path),
    delete: () => {},
    commit: async () => {},
  }),
}))

class FakeChannel {
  readyState = 'connecting'
  sent: PeerMsg[] = []
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 'closed'
  }
  /** What the other side puts on the wire. */
  receive(msg: object) {
    this.onmessage!({ data: JSON.stringify(msg) })
  }
}

const pcs: FakePC[] = []
class FakePC {
  ch = new FakeChannel()
  iceGatheringState = 'complete'
  signalingState = 'stable'
  connectionState = 'new'
  localDescription: unknown = null
  closed = false
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null
  constructor() {
    pcs.push(this)
  }
  createDataChannel() {
    return this.ch
  }
  async createOffer() {
    return { type: 'offer', sdp: '' }
  }
  async setLocalDescription(d: unknown) {
    this.localDescription = d
    this.signalingState = 'have-local-offer'
  }
  async setRemoteDescription() {}
  async createAnswer() {
    return { type: 'answer', sdp: '' }
  }
  addEventListener() {}
  close() {
    this.closed = true
    this.ch.readyState = 'closed'
  }
}

const CODE = 'ABCDE'
const ME = 'me'

function roomAt(seq: number): RoomDoc {
  const room = newRoomDoc(CODE, 'host', 'Host')
  room.seats = [room.seats[0], { uid: ME, name: 'Me', bot: false }, null, null]
  return { ...room, pub: toPublic(createMatch(0)), seq }
}

const snap = <T>(data: T | null) => ({ exists: () => data !== null, data: () => data })
const fsRoom = (r: RoomDoc) => fake.listeners.get(`rooms/${CODE}`)!(snap(r))
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const HAND_PATH = `rooms/${CODE}/hands/${ME}`
const handOf = (...cards: Card[]) => new Map([[ME, { cards }]])

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  pcs.length = 0
  fake.listeners.clear()
  fake.handWrites.length = 0
})

/** A host link with one guest on an open channel. */
async function hostWithGuest() {
  vi.useFakeTimers()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  const link = new P2PHostLink(CODE, 'host', true)
  await link.load()
  link.onIntent(async () => {})
  const offer = (offerTs: number) =>
    fake.listeners.get(`rooms/${CODE}/rtc`)!({
      docChanges: () => [{ type: 'added', doc: { id: ME, data: () => ({ offer: '{}', offerTs }) } }],
    })
  const open = async (offerTs: number) => {
    offer(offerTs)
    await advance(0)
    const pc = pcs[pcs.length - 1]
    const ch = new FakeChannel()
    ch.readyState = 'open'
    pc.ondatachannel!({ channel: ch })
    ch.onopen!()
    return { pc, ch }
  }
  return { link, open, hands: new Map([[ME, { cards: [] }]]) }
}

describe('host: a silent guest channel', () => {
  test('is dropped after DEAD_MS and the guest moves to Firestore', async () => {
    const { link, open, hands } = await hostWithGuest()
    const { pc, ch } = await open(1)
    await link.publish(roomAt(5), hands)
    expect(fake.handWrites).toEqual([])

    ch.receive({ t: 'ping' })
    expect(ch.sent.at(-1)).toEqual({ t: 'pong' })
    await advance(DEAD_MS + PING_MS)

    expect(pc.closed).toBe(true)
    expect(fake.handWrites).toContain(HAND_PATH)
    // From now on every publish reaches this guest through Firestore.
    fake.handWrites.length = 0
    await link.publish(roomAt(6), handOf(C('H', 'A')))
    await link.publish(roomAt(7), handOf(C('S', '9')))
    expect(fake.handWrites).toEqual([HAND_PATH, HAND_PATH])
    link.dispose()
  })

  test('Firestore writes stop when the guest has a channel again', async () => {
    const { link, open } = await hostWithGuest()
    const first = await open(1)
    first.ch.receive({ t: 'ping' })
    await advance(DEAD_MS + PING_MS)
    expect(first.pc.closed).toBe(true)

    fake.handWrites.length = 0
    await link.publish(roomAt(7), handOf(C('H', 'A')))
    expect(fake.handWrites).toEqual([HAND_PATH])

    await open(2)
    fake.handWrites.length = 0
    await link.publish(roomAt(8), handOf(C('S', '9')))
    await link.publish(roomAt(9), handOf(C('S', 'K')))
    expect(fake.handWrites).toEqual([])
    link.dispose()
  })

  test('stays when pings keep coming', async () => {
    const { link, open } = await hostWithGuest()
    const { pc, ch } = await open(1)
    for (let i = 0; i < 20; i++) {
      ch.receive({ t: 'ping' })
      await advance(PING_MS)
    }
    expect(pc.closed).toBe(false)
    link.dispose()
  })

  test('stays with a guest build that never pings', async () => {
    const { link, open } = await hostWithGuest()
    const { pc } = await open(1)
    await advance(DEAD_MS * 5)
    expect(pc.closed).toBe(false)
    link.dispose()
  })

  test('ignores a message type it does not know', async () => {
    const { link, open } = await hostWithGuest()
    const { pc, ch } = await open(1)
    expect(() => ch.receive({ t: 'from-the-future' })).not.toThrow()
    expect(pc.closed).toBe(false)
    link.dispose()
  })
})

describe('guest: a silent host channel', () => {
  async function guestOnChannel() {
    vi.useFakeTimers()
    vi.stubGlobal('RTCPeerConnection', FakePC)
    const session = new RoomSession(CODE, ME, new P2PGuestLink(CODE, ME))
    await advance(0)
    const ch = pcs[0].ch
    ch.readyState = 'open'
    ch.onopen!()
    fsRoom(roomAt(3))
    ch.receive({ t: 'state', room: roomAt(5), hand: { cards: [] } })
    return { session, ch }
  }

  test('is closed after DEAD_MS, a new channel is tried and Firestore shows again', async () => {
    const { session, ch } = await guestOnChannel()
    await advance(PING_MS)
    expect(ch.sent).toContainEqual({ t: 'ping' })
    ch.receive({ t: 'pong' })

    await advance(DEAD_MS + PING_MS)
    expect(ch.readyState).toBe('closed')
    expect(get(session.hostStale)).toBe(true)
    await advance(5000)
    expect(pcs.length).toBeGreaterThan(1) // the retry offers a new channel

    // The host moved this guest to Firestore: its newer copy shows.
    fsRoom(roomAt(7))
    expect(get(session.room)?.seq).toBe(7)
    session.dispose()
  })

  test('stays when the host answers', async () => {
    const { session, ch } = await guestOnChannel()
    for (let i = 0; i < 20; i++) {
      ch.receive({ t: 'pong' })
      await advance(PING_MS)
    }
    expect(ch.readyState).toBe('open')
    expect(get(session.hostStale)).toBe(false)
    session.dispose()
  })

  test('stays with a host build that never answers', async () => {
    const { session, ch } = await guestOnChannel()
    await advance(DEAD_MS * 5)
    expect(ch.readyState).toBe('open')
    session.dispose()
  })

  test('ignores a message type it does not know', async () => {
    const { session, ch } = await guestOnChannel()
    expect(() => ch.receive({ t: 'from-the-future' })).not.toThrow()
    expect(get(session.room)?.seq).toBe(5)
    session.dispose()
  })
})
