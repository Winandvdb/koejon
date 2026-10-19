import { describe, expect, test, vi } from 'vitest'
import { discardRoom, HostGame } from '../src/lib/host'
import { addSoloBots, localLinks, SOLO_CODE, soloPaused } from '../src/lib/link-local'
import type { RoomDoc } from '../src/lib/net-types'
import { pausable, pausedRoom } from '../src/lib/paused'
import { endRoom, newRoomDoc, RoomSession } from '../src/lib/room'
import { memoryStore, until } from './helpers'

// Firestore stand-in: docs by path, and the paths each batch deleted.
const fake = vi.hoisted(() => ({ docs: new Map<string, unknown>(), deleted: [] as string[] }))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  onSnapshot: () => () => {},
  getDoc: async (ref: { path: string }) => {
    const data = fake.docs.get(ref.path)
    return { exists: () => data !== undefined, data: () => data }
  },
  getDocs: async (col: { path: string }) => {
    const refs = [...fake.docs.keys()]
      .filter((p) => p.startsWith(`${col.path}/`) && !p.slice(col.path.length + 1).includes('/'))
      .map((path) => ({ ref: { path } }))
    return { forEach: (f: (d: { ref: { path: string } }) => void) => refs.forEach(f) }
  },
  setDoc: async () => {},
  updateDoc: async () => {},
  deleteDoc: async () => {},
  writeBatch: () => {
    const dels: string[] = []
    return {
      update: () => {},
      set: () => {},
      delete: (ref: { path: string }) => dels.push(ref.path),
      commit: async () => {
        for (const p of dels) fake.docs.delete(p)
        fake.deleted.push(...dels)
      },
    }
  },
}))

const UID = 'me'
const ROOM_KEYS = ['engine', 'seq', 'quotes', 'seats', 'kjn', 'kjn-final']

describe('pausable', () => {
  test('only a match between the start and GAME_OVER pauses', () => {
    expect(pausable(undefined)).toBe(false)
    expect(pausable('LOBBY')).toBe(false)
    expect(pausable('GAME_OVER')).toBe(false)
    for (const ph of ['DEALER_DRAW', 'CUTTING', 'DEALING', 'BIDDING_R1', 'PLAYING', 'SCORED'] as const) {
      expect(pausable(ph)).toBe(true)
    }
  })
})

describe('pausedRoom', () => {
  test('keeps one room code until cleared', () => {
    const storage = memoryStore()
    expect(pausedRoom.get(storage)).toBeNull()
    pausedRoom.set('ABCDE', storage)
    pausedRoom.set('FGHJK', storage)
    expect(pausedRoom.get(storage)).toBe('FGHJK')
    pausedRoom.clear(storage)
    expect(pausedRoom.get(storage)).toBeNull()
  })
})

async function soloHost(storage = memoryStore(), fresh = true) {
  const links = localLinks(UID, storage, fresh ? newRoomDoc(SOLO_CODE, UID, 'Me') : undefined)!
  const session = new RoomSession(SOLO_CODE, UID, links.guest, links.host, storage)
  const host = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dealLingerMs: 0,
  })
  let room: RoomDoc | null = null
  const unsub = session.room.subscribe((r) => (room = r))
  const leave = () => {
    unsub()
    host.dispose()
    session.dispose()
  }
  return { host, room: () => room, leave, storage }
}

/** Our seat never acts, so a started match stops at our first turn (draw, cut or bid). */
const waitsOnUs = (r: RoomDoc | null) => pausable(r?.pub?.phase) && !!r?.pub?.actionSeats.includes(0)

describe('paused solo match', () => {
  test('a lobby is no paused match', async () => {
    const g = await soloHost()
    expect(soloPaused(g.storage, UID)).toBe(false)
    await g.host.destroyRoom()
    g.leave()
  })

  test('leaving mid-match keeps it; resume goes on from the same hand', async () => {
    const g = await soloHost()
    addSoloBots(g.host, 'easy')
    g.host.startGame()
    await until(() => waitsOnUs(g.room()))
    // Leave without destroyRoom, as App does mid-match.
    g.leave()
    const left = g.room()!
    expect(soloPaused(g.storage, UID)).toBe(true)
    // A save of another uid (offline before the first sign-in) cannot attach.
    expect(soloPaused(g.storage, 'signed-in')).toBe(false)
    expect(g.storage.getItem(`koejon-engine-${SOLO_CODE}`)).not.toBeNull()

    const back = await soloHost(g.storage, false)
    await until(() => back.room() !== null)
    expect(back.room()!.pub).toEqual(left.pub)
    expect(back.room()!.seats).toEqual(left.seats)
    await back.host.destroyRoom()
    back.leave()
  }, 30_000)

  test('discardRoom ends it without a host: save and room keys go', async () => {
    const g = await soloHost()
    addSoloBots(g.host, 'easy')
    g.host.startGame()
    await until(() => waitsOnUs(g.room()))
    g.leave()

    await discardRoom(SOLO_CODE, localLinks(UID, g.storage)!.host, g.storage)
    expect(soloPaused(g.storage, UID)).toBe(false)
    expect(localLinks(UID, g.storage)).toBeNull()
    for (const key of ROOM_KEYS) expect(g.storage.getItem(`koejon-${key}-${SOLO_CODE}`)).toBeNull()
  }, 30_000)
})

describe('endRoom', () => {
  test('deletes the room doc and the hand docs of its human seats', async () => {
    const r = newRoomDoc('ABCDE', 'host', 'Host')
    r.seats[1] = { uid: 'guest', name: 'Guest', bot: false }
    r.seats[2] = { uid: 'bot-1', name: 'Bot', bot: true }
    fake.docs.set('rooms/ABCDE', r)
    fake.deleted = []
    await endRoom('ABCDE')
    expect(fake.docs.has('rooms/ABCDE')).toBe(false)
    expect(fake.deleted.sort()).toEqual(['rooms/ABCDE', 'rooms/ABCDE/hands/guest', 'rooms/ABCDE/hands/host'])
  })

  test('also deletes the intents and offers that guests wrote during the pause', async () => {
    fake.docs.set('rooms/ABCDE', newRoomDoc('ABCDE', 'host', 'Host'))
    fake.docs.set('rooms/ABCDE/actions/guest', { intent: { kind: 'leave' } })
    fake.docs.set('rooms/ABCDE/rtc/guest', { offer: '{}', offerTs: 1 })
    fake.docs.set('rooms/OTHER/rtc/guest', { offer: '{}', offerTs: 1 })
    await endRoom('ABCDE')
    expect([...fake.docs.keys()].filter((p) => p.startsWith('rooms/ABCDE'))).toEqual([])
    expect(fake.docs.has('rooms/OTHER/rtc/guest')).toBe(true)
  })

  test('takes the saved seats over the room doc, as the host does', async () => {
    const storage = memoryStore()
    const r = newRoomDoc('ABCDE', 'host', 'Host')
    fake.docs.set('rooms/ABCDE', r)
    const seats = [...r.seats]
    seats[3] = { uid: 'late', name: 'Late', bot: false }
    storage.setItem('koejon-seats-ABCDE', JSON.stringify(seats))
    fake.deleted = []
    const { FirestoreHostLink } = await import('../src/lib/link-firestore')
    await discardRoom('ABCDE', new FirestoreHostLink('ABCDE'), storage)
    expect(fake.deleted).toContain('rooms/ABCDE/hands/late')
    expect(storage.getItem('koejon-seats-ABCDE')).toBeNull()
  })

  test('a room that is gone already is no error', async () => {
    fake.deleted = []
    await expect(endRoom('GONE1')).resolves.toBeUndefined()
    expect(fake.deleted).toEqual([])
  })
})
