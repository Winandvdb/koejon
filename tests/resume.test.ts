import { describe, expect, test, vi } from 'vitest'
import type { RoomDoc } from '../src/lib/net-types'
import { newRoomDoc, resumeRoom } from '../src/lib/room'

// Firestore stand-in: one room per code, and a count of every read.
const fake = vi.hoisted(() => ({ rooms: new Map<string, unknown>(), reads: 0 }))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  onSnapshot: () => () => {},
  getDoc: async (ref: { path: string }) => {
    fake.reads++
    const data = fake.rooms.get(ref.path)
    return { exists: () => data !== undefined, data: () => data }
  },
  setDoc: async () => {},
  updateDoc: async () => {},
  deleteDoc: async () => {},
  writeBatch: () => ({ update: () => {}, set: () => {}, delete: () => {}, commit: async () => {} }),
}))

const CODE = 'ABCDE'
const HOST = 'host'
const GUEST = 'guest'

function room(): RoomDoc {
  const r = newRoomDoc(CODE, HOST, 'Host')
  r.seats[1] = { uid: GUEST, name: 'Guest', bot: false }
  return r
}

describe('resumeRoom', () => {
  test('reads the room once, for the host', async () => {
    fake.rooms.set(`rooms/${CODE}`, room())
    fake.reads = 0
    const s = await resumeRoom(CODE, HOST, 'Host')
    expect(s?.code).toBe(CODE)
    expect(s?.hostLink).toBeTruthy()
    expect(fake.reads).toBe(1)
    s?.dispose()
  })

  test('reads the room once, for a guest', async () => {
    fake.rooms.set(`rooms/${CODE}`, room())
    fake.reads = 0
    const s = await resumeRoom(CODE, GUEST, 'Guest')
    expect(s?.code).toBe(CODE)
    expect(s?.hostLink).toBeUndefined()
    expect(fake.reads).toBe(1)
    s?.dispose()
  })

  test('null when the seat is not ours or the room is gone', async () => {
    fake.rooms.set(`rooms/${CODE}`, room())
    fake.reads = 0
    expect(await resumeRoom(CODE, 'stranger', 'Nobody')).toBeNull()
    expect(await resumeRoom('GONE1', HOST, 'Host')).toBeNull()
    expect(fake.reads).toBe(2)
  })
})
