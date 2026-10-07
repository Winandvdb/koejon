import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMatch, toPublic } from '../src/engine'
import type { Card } from '../src/engine'
import { HostGame } from '../src/lib/host'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import { P2PGuestLink, P2PHostLink } from '../src/lib/link-p2p'
import type { HandDoc, RoomDoc } from '../src/lib/net-types'
import { ACT_ACK_MS, newRoomDoc, RoomSession } from '../src/lib/room'
import type { GuestEvents, GuestLink, HostLink } from '../src/lib/transport'
import { C, memoryStore, playingState } from './helpers'

// Firestore stand-in: tests fire each listener by hand, as a late snapshot would.
const fake = vi.hoisted(() => ({
  listeners: new Map<string, (snap: unknown) => void>(),
  /** Paths of hand docs the host wrote, in order. */
  handWrites: [] as string[],
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('../src/lib/fs', () => ({
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
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  send() {}
  close() {
    this.readyState = 'closed'
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
const fsHand = (cards: Card[]) => fake.listeners.get(`rooms/${CODE}/hands/${ME}`)!(snap({ cards }))
const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  pcs.length = 0
  fake.listeners.clear()
  fake.handWrites.length = 0
})

describe('no rollback on a flaky connection', () => {
  test('a late Firestore copy never replaces a newer state from the data channel', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    const link = new P2PGuestLink(CODE, ME)
    const session = new RoomSession(CODE, ME, link)
    await tick()
    const ch = pcs[0].ch

    fsRoom(roomAt(3))
    fsHand([C('H', 'A'), C('S', '9')])
    expect(get(session.room)?.seq).toBe(3)

    // The channel brings our accepted play and the next player's card.
    ch.readyState = 'open'
    ch.onopen!()
    const hand: HandDoc = { cards: [C('S', '9')] }
    ch.onmessage!({ data: JSON.stringify({ t: 'state', room: roomAt(5), hand }) })
    expect(get(session.room)?.seq).toBe(5)

    // Weak connection: the channel dies and an old Firestore copy arrives.
    ch.readyState = 'closed'
    ch.onclose!()
    fsRoom(roomAt(3))
    fsHand([C('H', 'A'), C('S', '9')])
    expect(get(session.room)?.seq).toBe(5)
    expect(get(session.handDoc)).toEqual(hand)

    // The host resyncs Firestore: newer state comes through again.
    fsHand([])
    fsRoom(roomAt(6))
    expect(get(session.room)?.seq).toBe(6)
    expect(get(session.handDoc)).toEqual({ cards: [] })

    session.dispose()
    vi.unstubAllGlobals()
  })

  test('the game seq goes up after a failed publish and across a host reload', async () => {
    const storage = memoryStore()
    const links = localLinks(ME, storage, newRoomDoc(SOLO_CODE, ME, 'Me'))!
    const seqs: number[] = []
    let fail = false
    const link: HostLink = {
      ...links.host,
      // As on the P2P path: the room doc lags behind the game.
      load: async () => ({ ...(await links.host.load())!, version: 1, seq: undefined }),
      publish: async (u, h) => {
        seqs.push(u.seq!)
        if (fail) throw new Error('firestore-write-timeout')
        await links.host.publish(u, h)
      },
    }
    const opts = { storage, botDelay: () => 1e9 }
    const host = await HostGame.attach(SOLO_CODE, ME, link, opts)
    host.onError = () => {}
    fail = true
    host.addBot(1)
    fail = false
    host.addBot(2)
    await vi.waitFor(() => expect(seqs).toHaveLength(2))
    expect(seqs[1]).toBeGreaterThan(seqs[0])
    host.dispose()

    const again = await HostGame.attach(SOLO_CODE, ME, link, opts)
    again.addBot(3)
    await vi.waitFor(() => expect(seqs).toHaveLength(3))
    expect(seqs[2]).toBeGreaterThan(seqs[1])
    again.dispose()
  })

  test('an intent through Firestore moves that guest off its dead channel', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    const link = new P2PHostLink(CODE, 'host', true)
    await link.load()
    const got: string[] = []
    link.onIntent(async (uid) => void got.push(uid))
    fake.listeners.get(`rooms/${CODE}/rtc`)!({
      docChanges: () => [{ type: 'added', doc: { id: ME, data: () => ({ offer: '{}', offerTs: 1 }) } }],
    })
    await tick()
    const pc = pcs[0]
    const ch = new FakeChannel()
    ch.readyState = 'open'
    pc.ondatachannel!({ channel: ch })
    ch.onopen!()
    const hands = new Map([[ME, { cards: [] }]])
    await link.publish(roomAt(5), hands)
    expect(fake.handWrites).toEqual([])

    // The guest's channel died unnoticed here; it falls back to an intent doc.
    fake.listeners.get(`rooms/${CODE}/actions`)!({
      docChanges: () => [{ type: 'added', doc: { id: ME, ref: {}, data: () => ({ intent: { kind: 'leave' } }) } }],
    })
    await tick()
    expect(got).toEqual([ME])
    expect(pc.closed).toBe(true)
    // So the answer to that intent reaches the guest through Firestore.
    await link.publish(roomAt(6), hands)
    expect(fake.handWrites).toContain(`rooms/${CODE}/hands/${ME}`)
    link.dispose()
  })
})

describe('act waits for the host', () => {
  function fakeSession() {
    let ev!: GuestEvents
    const link: GuestLink = { start: (e) => (ev = e), send: async () => {}, dispose: () => {} }
    const session = new RoomSession(CODE, ME, link)
    ev.room(roomAt(4))
    return { session, ev }
  }

  test('resolves once a newer state arrives', async () => {
    const { session, ev } = fakeSession()
    const p = session.act({ type: 'ack', seat: 1 })
    await tick()
    ev.room(roomAt(5))
    await expect(p).resolves.toBeUndefined()
  })

  test('rejects when no newer state arrives in time', async () => {
    vi.useFakeTimers()
    const { session } = fakeSession()
    const p = session.act({ type: 'ack', seat: 1 })
    const done = expect(p).rejects.toThrow('act-lost')
    await vi.advanceTimersByTimeAsync(ACT_ACK_MS)
    await done
  })

  test('a newer state from another move does not confirm ours', async () => {
    vi.useFakeTimers()
    const { session, ev } = fakeSession()
    const card = C('S', '9')
    const playing = { ...roomAt(5), pub: toPublic(playingState()) }
    ev.room(playing)
    ev.hand({ cards: [card] })
    const p = session.act({ type: 'play', seat: 1, card })
    const done = expect(p).rejects.toThrow('act-lost')
    await vi.advanceTimersByTimeAsync(0)
    // A new state in which our card is still to play: our move did not land.
    ev.room({ ...playing, seq: 6 })
    await vi.advanceTimersByTimeAsync(ACT_ACK_MS)
    await done
  })
})
