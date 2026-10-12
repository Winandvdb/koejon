import { afterEach, expect, test, vi } from 'vitest'
import { HostGame } from '../src/lib/host'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import type { RoomDoc } from '../src/lib/net-types'
import { newRoomDoc } from '../src/lib/room'
import { memoryStore } from './helpers'

const UID = 'me'

afterEach(() => {
  vi.restoreAllMocks()
})

test('an act intent with action start changes nothing, also from the host uid', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const storage = memoryStore()
  const room: RoomDoc = newRoomDoc(SOLO_CODE, UID, 'Me')
  room.seats = [
    room.seats[0],
    { uid: 'bot:1', name: 'B1', bot: true },
    { uid: 'bot:2', name: 'B2', bot: true },
    { uid: 'bot:3', name: 'B3', bot: true },
  ]
  let latest: RoomDoc | null = null
  let publishes = 0
  const links = localLinks(UID, storage, room)!
  links.guest.start({
    room: (r) => ((latest = r), publishes++),
    hand: () => {},
    state: (r) => ((latest = r), publishes++),
    lost: () => {},
    hostStale: () => {},
  })
  const host = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dealLingerMs: 0,
    quoteRand: () => 1,
  })
  try {
    const before = publishes
    const seq = (latest as RoomDoc | null)!.seq
    await links.guest.send({ kind: 'act', action: { type: 'start', seat: 0 } })
    await new Promise((r) => setTimeout(r, 50))
    expect((latest as RoomDoc | null)!.pub!.phase).toBe('LOBBY')
    expect((latest as RoomDoc | null)!.seq).toBe(seq)
    expect(publishes).toBe(before)
  } finally {
    host.dispose()
  }
})
