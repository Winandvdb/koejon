import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMatch, toPublic } from '../src/engine'
import { botAction } from '../src/bots/bot'
import { addHistory, HISTORY_KEY, HISTORY_MAX, readHistory } from '../src/lib/history'
import { HostGame } from '../src/lib/host'
import type { GameDoc } from '../src/lib/kjn'
import { FirestoreGuestLink, FirestoreHostLink } from '../src/lib/link-firestore'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import type { KeyValueStore } from '../src/lib/storage'
import { P2PGuestLink, P2PHostLink } from '../src/lib/link-p2p'
import type { HandDoc, RoomDoc } from '../src/lib/net-types'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import type { GuestEvents, GuestLink, HostLink, RoomUpdate } from '../src/lib/transport'
import { finishedMatch as finished, memoryStore, until } from './helpers'

// Firestore stand-in that counts writes and keeps the room payloads.
const fake = vi.hoisted(() => ({
  listeners: new Map<string, (snap: unknown) => void>(),
  writes: 0,
  rooms: [] as Record<string, unknown>[],
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  onSnapshot: (ref: { path: string }, next: (snap: unknown) => void) => {
    fake.listeners.set(ref.path, next)
    return () => fake.listeners.delete(ref.path)
  },
  setDoc: async () => void fake.writes++,
  updateDoc: async () => void fake.writes++,
  deleteDoc: async () => void fake.writes++,
  getDoc: async () => ({ exists: () => false }),
  writeBatch: () => {
    let n = 0
    return {
      update: (_ref: unknown, data: Record<string, unknown>) => {
        n++
        fake.rooms.push(data)
      },
      set: () => void n++,
      delete: () => void n++,
      commit: async () => void (fake.writes += n),
    }
  },
}))

class FakeChannel {
  readyState = 'open'
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  send(d: string) {
    this.sent.push(d)
  }
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
  close() {}
}

afterEach(() => {
  vi.unstubAllGlobals()
  pcs.length = 0
  fake.listeners.clear()
  fake.writes = 0
  fake.rooms.length = 0
})

const CODE = 'ABCDE'
const ME = 'me'
const MATCH = finished(5)

function overRoom(kjn: string | null = MATCH.kjn, seq = 9): RoomDoc {
  return {
    ...newRoomDoc(CODE, 'host', 'Host'),
    seats: [
      { uid: 'host', name: 'Host', bot: false },
      { uid: ME, name: 'Me', bot: false },
      { uid: 'bot:2', name: 'Piet', bot: true },
      { uid: 'bot:3', name: 'Ans', bot: true },
    ],
    pub: toPublic(MATCH.final),
    seq,
    kjn,
  }
}

const updateOf = (r: RoomDoc): RoomUpdate => ({
  seats: r.seats,
  pub: r.pub,
  version: r.version,
  seq: r.seq,
  opts: r.opts,
  quotes: [],
  kjn: r.kjn,
})

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('history store', () => {
  test('keeps a match once, with seat, names and the KJN text', () => {
    const store = memoryStore()
    expect(addHistory({ seat: 1, names: ['A', 'B', 'C', 'D'], kjn: MATCH.kjn }, store, 1234)).toBe(true)
    expect(addHistory({ seat: 1, names: ['A', 'B', 'C', 'D'], kjn: MATCH.kjn }, store, 5678)).toBe(false)
    const list = readHistory(store)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ finishedAt: 1234, seat: 1, names: ['A', 'B', 'C', 'D'], kjn: MATCH.kjn })
    expect(list[0].id).toMatch(/\S{8,}/)
  })

  test('keeps at most HISTORY_MAX matches and drops the oldest first', () => {
    const store = memoryStore()
    const texts = Array.from({ length: HISTORY_MAX + 2 }, (_, i) => finished(100 + i).kjn)
    texts.forEach((kjn, i) => addHistory({ seat: 0, names: [], kjn }, store, i))
    const list = readHistory(store)
    expect(HISTORY_MAX).toBe(20)
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list.map((e) => e.kjn)).toEqual(texts.slice(2))
    expect(list[0].finishedAt).toBe(2)
  })

  test('a record that does not parse is not kept', () => {
    const store = memoryStore()
    expect(addHistory({ seat: 0, names: [], kjn: MATCH.kjn.replace('KJN/1', 'KJN/9') }, store)).toBe(false)
    expect(store.getItem(HISTORY_KEY)).toBeNull()
  })

  test('a full or blocked storage loses the entry without throwing', () => {
    const thrower = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    const broken: KeyValueStore = { getItem: thrower, setItem: thrower, removeItem: thrower }
    expect(addHistory({ seat: 0, names: [], kjn: MATCH.kjn }, broken)).toBe(false)
    expect(readHistory(broken)).toEqual([])
  })
})

describe('session saves the finished match', () => {
  function fakeSession(uid: string, store: KeyValueStore) {
    let ev!: GuestEvents
    const link: GuestLink = { start: (e) => (ev = e), send: async () => {}, dispose: () => {} }
    const session = new RoomSession(CODE, uid, link, undefined, store)
    return { session, ev }
  }

  test('once per match, also after a reload on the end screen', () => {
    const store = memoryStore()
    const a = fakeSession(ME, store)
    a.ev.room(overRoom())
    a.ev.room({ ...overRoom(), seq: 10 })
    a.session.dispose()
    const b = fakeSession(ME, store)
    b.ev.room(overRoom())
    expect(readHistory(store)).toHaveLength(1)
    expect(readHistory(store)[0]).toMatchObject({ seat: 1, names: ['Host', 'Me', 'Piet', 'Ans'], kjn: MATCH.kjn })
    b.session.dispose()
  })

  test('later updates of the same match do not read the history again', () => {
    const store = memoryStore()
    let reads = 0
    const counted: KeyValueStore = { ...store, getItem: (k) => (reads++, store.getItem(k)) }
    const s = fakeSession(ME, counted)
    s.ev.room(overRoom())
    const after = reads
    s.ev.room({ ...overRoom(), seq: 10 })
    s.ev.room({ ...overRoom(), seq: 11 })
    expect(reads).toBe(after)
    s.session.dispose()
  })

  test('spectators and seats held by a bot save nothing', () => {
    const store = memoryStore()
    const spectator = fakeSession('nobody', store)
    spectator.ev.room(overRoom())
    const left = fakeSession(ME, store)
    const room = overRoom()
    room.seats[1] = { uid: ME, name: 'Me', bot: true }
    left.ev.room(room)
    expect(store.getItem(HISTORY_KEY)).toBeNull()
  })

  test('nothing is saved before GAME_OVER', () => {
    const store = memoryStore()
    const s = fakeSession(ME, store)
    s.ev.room({ ...overRoom(), pub: toPublic(createMatch(1)) })
    expect(store.getItem(HISTORY_KEY)).toBeNull()
  })
})

describe('host sends the record at GAME_OVER', () => {
  test('solo: only the GAME_OVER commit carries the KJN text, and the player keeps it', async () => {
    const storage = memoryStore()
    const history = memoryStore()
    const games: GameDoc[] = []
    const links = localLinks(ME, storage, newRoomDoc(SOLO_CODE, ME, 'Me'))!
    const published: RoomUpdate[] = []
    const link: HostLink = {
      ...links.host,
      publish: async (u, h) => {
        published.push(structuredClone(u))
        await links.host.publish(u, h)
      },
    }
    const session = new RoomSession(SOLO_CODE, ME, links.guest, link, history)
    const save = async (_id: string, g: GameDoc) => void games.push(g)
    const host = await HostGame.attach(SOLO_CODE, ME, link, { storage, botDelay: () => 0, drawLingerMs: 0, bidLingerMs: 0, dealLingerMs: 0, saveGame: save })
    host.onError = (e) => {
      throw e
    }
    let latest: SessionView | null = null
    const unsub = session.view.subscribe((v) => {
      latest = v
      const pub = v.room?.pub
      if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
      if (pub.actionSeats.includes(v.mySeat)) host.submit({ kind: 'act', action: botAction(v.state, v.mySeat) })
    })
    host.addBot(1)
    host.addBot(2)
    host.addBot(3)
    host.startGame()
    await until(() => latest?.room?.pub?.phase === 'GAME_OVER' && games.length > 0)

    // No dealt cards leave the host before the match is over.
    for (const u of published) if (u.pub?.phase !== 'GAME_OVER') expect(u.kjn ?? null).toBeNull()
    expect(published.at(-1)!.kjn).toBe(games[0].kjn)
    const list = readHistory(history)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ seat: 0, kjn: games[0].kjn })
    expect(list[0].names).toEqual(latest!.room!.seats.map((s) => s!.name))

    // A host reload on the end screen sends the same record; the player keeps one.
    unsub()
    host.dispose()
    session.dispose()
    const links2 = localLinks(ME, storage)!
    const link2 = links2.host
    const session2 = new RoomSession(SOLO_CODE, ME, links2.guest, link2, history)
    const host2 = await HostGame.attach(SOLO_CODE, ME, link2, { storage, botDelay: () => 0, saveGame: async () => {} })
    await until(() => (get(session2.room)?.seq ?? 0) > published.at(-1)!.seq!)
    expect(get(session2.room)!.kjn).toBe(games[0].kjn)
    expect(readHistory(history)).toHaveLength(1)

    // A new match clears the record from the room.
    host2.newMatch()
    await until(() => get(session2.room)?.pub?.phase !== 'GAME_OVER')
    expect(get(session2.room)!.kjn).toBeNull()
    host2.dispose()
    session2.dispose()
  }, 60_000)
})

describe('the record reaches guests', () => {
  test('over a data channel', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePC)
    const link = new P2PHostLink(CODE, 'host', true)
    await link.load()
    link.onIntent(async () => {})
    fake.listeners.get(`rooms/${CODE}/rtc`)!({
      docChanges: () => [{ type: 'added', doc: { id: ME, data: () => ({ offer: '{}', offerTs: 1 }) } }],
    })
    await tick()
    const ch = new FakeChannel()
    pcs[0].ondatachannel!({ channel: ch })
    ch.onopen!()
    await link.publish(updateOf(overRoom()), new Map<string, HandDoc>([[ME, { cards: [] }]]))
    const msg = JSON.parse(ch.sent.at(-1)!) as { room: RoomDoc }
    expect(msg.room.kjn).toBe(MATCH.kjn)
    link.dispose()

    // The guest side keeps what the channel brings.
    const store = memoryStore()
    const guest = new P2PGuestLink(CODE, ME)
    const session = new RoomSession(CODE, ME, guest, undefined, store)
    await tick()
    const gch = pcs.at(-1)!.ch
    gch.onopen!()
    gch.onmessage!({ data: JSON.stringify({ t: 'state', room: overRoom(), hand: null }) })
    expect(readHistory(store)[0]?.kjn).toBe(MATCH.kjn)
    session.dispose()
  })

  test('over the Firestore fallback, on the GAME_OVER write itself', async () => {
    const hands = new Map<string, HandDoc>([[ME, { cards: [] }]])
    const without = new FirestoreHostLink(CODE)
    await without.publish(updateOf(overRoom(null)), hands)
    const plain = fake.writes
    fake.writes = 0
    fake.rooms.length = 0

    const link = new FirestoreHostLink(CODE)
    await link.publish(updateOf(overRoom()), hands)
    expect(fake.writes).toBe(plain)
    expect(fake.rooms).toHaveLength(1)
    expect(fake.rooms[0].kjn).toBe(MATCH.kjn)

    const store = memoryStore()
    const session = new RoomSession(CODE, ME, new FirestoreGuestLink(CODE, ME), undefined, store)
    fake.listeners.get(`rooms/${CODE}`)!({ exists: () => true, data: () => ({ ...overRoom(), ...fake.rooms[0] }) })
    expect(readHistory(store)[0]?.kjn).toBe(MATCH.kjn)
    session.dispose()
  })

  test('a P2P host with a Firestore guest adds no write for the record', async () => {
    const hands = new Map<string, HandDoc>([[ME, { cards: [] }]])
    const without = new P2PHostLink(CODE, 'host', false)
    await without.load()
    await without.publish(updateOf(overRoom(null)), hands)
    const plain = fake.writes
    fake.writes = 0
    fake.rooms.length = 0

    const link = new P2PHostLink(CODE, 'host', false)
    await link.load()
    await link.publish(updateOf(overRoom()), hands)
    expect(fake.writes).toBe(plain)
    expect(fake.rooms.at(-1)!.kjn).toBe(MATCH.kjn)
    without.dispose()
    link.dispose()
  })
})
