import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMatch, toPublic } from '../src/engine'
import type { Card } from '../src/engine'
import { HostGame } from '../src/lib/host'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import { FirestoreGuestLink } from '../src/lib/link-firestore'
import { P2PGuestLink, P2PHostLink } from '../src/lib/link-p2p'
import type { HandDoc, Intent, RoomDoc, SeatInfo } from '../src/lib/net-types'
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

describe('room and hand reach the view together', () => {
  /** Every view the session emits, as [room seq, hand]. */
  function record(session: RoomSession) {
    const seen: [number | undefined, HandDoc | null][] = []
    session.view.subscribe((v) => seen.push([v.room?.seq, v.hand && { cards: v.hand }]))
    return seen
  }
  const a: HandDoc = { cards: [C('H', 'A'), C('S', '9')] }
  const b: HandDoc = { cards: [C('S', '9')] }

  test('local link: one view per publish', async () => {
    const links = localLinks(ME, memoryStore(), roomAt(4))!
    const seen = record(new RoomSession(SOLO_CODE, ME, links.guest, links.host))
    await links.host.publish(roomAt(5), new Map([[ME, a]]))
    await links.host.publish(roomAt(6), new Map([[ME, b]]))
    expect(seen).toEqual([
      [4, null],
      [5, a],
      [6, b],
    ])
  })

  test('p2p host tab: one view per publish', async () => {
    const link = new P2PHostLink(CODE, ME, false)
    const session = new RoomSession(CODE, ME, link.guest, link)
    await link.load()
    const seen = record(session)
    await link.publish(roomAt(5), new Map([[ME, a]]))
    await link.publish(roomAt(6), new Map([[ME, b]]))
    expect(seen.slice(-2)).toEqual([
      [5, a],
      [6, b],
    ])
    link.dispose()
  })

  test('p2p guest: one view per channel message', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    const session = new RoomSession(CODE, ME, new P2PGuestLink(CODE, ME))
    await tick()
    const ch = pcs[0].ch
    ch.readyState = 'open'
    ch.onopen!()
    const seen = record(session)
    ch.onmessage!({ data: JSON.stringify({ t: 'state', room: roomAt(5), hand: a }) })
    ch.onmessage!({ data: JSON.stringify({ t: 'state', room: roomAt(6), hand: b }) })
    expect(seen.slice(1)).toEqual([
      [5, a],
      [6, b],
    ])
    session.dispose()
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

describe('guest seat after the host was away (#54)', () => {
  const botMe = (room: RoomDoc): RoomDoc => ({
    ...room,
    seats: room.seats.map((s) => (s?.uid === ME ? { ...s, bot: true } : s)),
  })

  function guestSession() {
    let ev!: GuestEvents
    const sent: Intent[] = []
    const link: GuestLink = {
      start: (e) => (ev = e),
      send: async (i) => void sent.push(i),
      dispose: () => {},
    }
    const session = new RoomSession(CODE, ME, link)
    ev.room(roomAt(4))
    return { session, ev, sent }
  }

  test('a bot in our own seat with our uid makes the session reclaim it', async () => {
    const { ev, sent } = guestSession()
    ev.room(botMe(roomAt(5)))
    ev.room(botMe(roomAt(6)))
    await tick()
    // One join per takeover, with the seat's name: the host keeps it.
    expect(sent).toEqual([{ kind: 'join', name: 'Me' }])

    ev.room(roomAt(7))
    ev.room(botMe(roomAt(8)))
    await tick()
    expect(sent).toHaveLength(2)
  })

  test('no reclaim after the player left on purpose', async () => {
    const { session, ev, sent } = guestSession()
    await session.leave()
    ev.room(botMe(roomAt(5)))
    await tick()
    expect(sent).toEqual([{ kind: 'leave' }])
  })

  test('a missing room from the local cache does not end the session', () => {
    const link = new FirestoreGuestLink(CODE, ME)
    const rooms: (RoomDoc | null)[] = []
    link.start({ room: (r) => rooms.push(r), hand: () => {}, lost: () => {}, hostStale: () => {} })
    const room = fake.listeners.get(`rooms/${CODE}`)!
    const missing = (fromCache: boolean) => ({ exists: () => false, data: () => null, metadata: { fromCache } })
    // One object: roomAt stamps the clock, so two calls can differ.
    const r3 = roomAt(3)
    room(snap(r3))
    room(missing(true))
    expect(rooms).toHaveLength(1)
    // The server says it is gone: the host closed the room.
    room(missing(false))
    expect(rooms).toEqual([r3, null])
    link.dispose()
  })

  test('a reloaded host keeps its own seats over an older room doc', async () => {
    const storage = memoryStore()
    const links = localLinks(ME, storage, newRoomDoc(SOLO_CODE, ME, 'Me'))!
    let intent!: (uid: string, i: Intent) => Promise<void>
    // What Firestore holds once the host's writes stop landing.
    let frozen: RoomDoc | null = null
    const seats: (SeatInfo | null)[][] = []
    const link: HostLink = {
      ...links.host,
      onIntent: (cb) => {
        intent = cb
        links.host.onIntent(cb)
      },
      load: async () => structuredClone(frozen ?? (await links.host.load())),
      publish: async (u, h) => {
        seats.push(structuredClone(u.seats))
        await links.host.publish(u, h)
      },
    }
    const opts = { storage, botDelay: () => 1e9 }
    const host = await HostGame.attach(SOLO_CODE, ME, link, opts)
    await intent('G', { kind: 'join', name: 'Guest' })
    host.addBot(2)
    host.addBot(3)
    host.startGame()
    await vi.waitFor(() => expect(seats).toHaveLength(4))
    await intent('G', { kind: 'leave' })
    frozen = structuredClone(await links.host.load())
    expect(frozen!.seats[1]).toMatchObject({ uid: 'G', bot: true })
    // The guest is back, but this write never reaches the room doc.
    await intent('G', { kind: 'join', name: 'Guest' })
    host.dispose()

    const again = await HostGame.attach(SOLO_CODE, ME, link, opts)
    await vi.waitFor(() => expect(seats).toHaveLength(7))
    expect(seats[6][1]).toEqual({ uid: 'G', name: 'Guest', bot: false })
    again.dispose()
  })

  test('a human seat that turns bot is logged with the reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = memoryStore()
    const links = localLinks(ME, storage, newRoomDoc(SOLO_CODE, ME, 'Me'))!
    let intent!: (uid: string, i: Intent) => Promise<void>
    const link: HostLink = {
      ...links.host,
      onIntent: (cb) => {
        intent = cb
        links.host.onIntent(cb)
      },
    }
    const host = await HostGame.attach(SOLO_CODE, ME, link, { storage, botDelay: () => 1e9 })
    await intent('G', { kind: 'join', name: 'Guest' })
    await intent('H', { kind: 'join', name: 'Other' })
    host.addBot(3)
    host.startGame()
    await intent('G', { kind: 'leave' })
    host.kickSeat(2)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
    expect(warn.mock.calls[0].join(' ')).toMatch(/seat 1 .*G.* leave/)
    expect(warn.mock.calls[1].join(' ')).toMatch(/seat 2 .*H.* kick/)
    host.dispose()
    warn.mockRestore()
  })

  test('a kicked player cannot reclaim the seat, a player who left can', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = memoryStore()
    const links = localLinks(ME, storage, newRoomDoc(SOLO_CODE, ME, 'Me'))!
    let intent!: (uid: string, i: Intent) => Promise<void>
    const link: HostLink = {
      ...links.host,
      onIntent: (cb) => {
        intent = cb
        links.host.onIntent(cb)
      },
    }
    const host = await HostGame.attach(SOLO_CODE, ME, link, { storage, botDelay: () => 1e9 })
    await intent('G', { kind: 'join', name: 'Guest' })
    await intent('H', { kind: 'join', name: 'Other' })
    host.addBot(3)
    host.startGame()
    await intent('G', { kind: 'leave' })
    host.kickSeat(2)
    await vi.waitFor(async () => expect((await links.host.load())!.seats[2]?.bot).toBe(true))

    await intent('H', { kind: 'join', name: 'Other' })
    await intent('G', { kind: 'join', name: 'Guest' })
    const seats = (await links.host.load())!.seats
    expect(seats[2]).toMatchObject({ bot: true })
    expect(seats[2]!.uid).not.toBe('H')
    expect(seats[1]).toEqual({ uid: 'G', name: 'Guest', bot: false })
    host.dispose()
    vi.restoreAllMocks()
  })
})
