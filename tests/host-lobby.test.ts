import { expect, test } from 'vitest'
import { createMatch, toPublic, type State } from '../src/engine'
import { HostGame } from '../src/lib/host'
import type { Intent, RoomDoc, SeatInfo } from '../src/lib/net-types'
import { newRoomDoc } from '../src/lib/room'
import type { HostLink, RoomUpdate } from '../src/lib/transport'
import { finishedMatch, memoryStore, playingState, until } from './helpers'

const CODE = 'LOBBY'
const UID = 'me'

const SEATS: SeatInfo[] = [
  { uid: UID, name: 'Me', bot: false },
  { uid: 'p1', name: 'Ann', bot: false },
  { uid: 'bot:2', name: 'Klaas', bot: true, botLevel: 'hard' },
  // Bob left during the match: a bot holds his seat under his uid.
  { uid: 'p3', name: 'Bob', bot: true },
]

/** A host over an in-memory link, attached to a room in the given state. */
async function hostIn(state: State, docState = state, quoteRand = () => 1) {
  const storage = memoryStore()
  storage.setItem(`koejon-engine-${CODE}`, JSON.stringify(state))
  storage.setItem(`koejon-kjn-final-${CODE}`, 'KJN/1 test')
  const room: RoomDoc = {
    ...newRoomDoc(CODE, UID, 'Me'),
    seats: SEATS.map((s) => ({ ...s })),
    pub: toPublic(docState),
    opts: { info: false, score: true },
    quotes: [{ n: 1, seat: 2, text: 'Allez', at: 0 }],
  }
  let intent: (uid: string, i: Intent) => Promise<void> = async () => {}
  let latest: RoomUpdate | null = null
  const link: HostLink = {
    load: async () => room,
    onIntent: (cb) => (intent = cb),
    publish: async (r) => void (latest = structuredClone(r)),
    heartbeat: () => {},
    destroy: async () => {},
    dispose: () => {},
  }
  const host = await HostGame.attach(CODE, UID, link, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dealLingerMs: 0,
    quoteRand,
  })
  await until(() => latest !== null)
  return { host, room: () => latest!, send: (uid: string, i: Intent) => intent(uid, i) }
}

test('toLobby moves a finished match back to the lobby with the same seats', async () => {
  const { final } = finishedMatch(3)
  const g = await hostIn(final, final, () => 0)
  try {
    expect(g.room().pub!.phase).toBe('GAME_OVER')
    expect(g.room().kjn).toBe('KJN/1 test')
    expect(g.room().quotes).not.toEqual([])
    const before = g.room().version
    g.host.toLobby()
    await until(() => g.room().version > before)
    const r = g.room()
    expect(r.pub!.phase).toBe('LOBBY')
    // The seat that Bob left is free again.
    expect(r.seats).toEqual([...SEATS.slice(0, 3), null])
    expect(r.opts).toEqual({ info: false, score: true })
    expect(r.quotes).toEqual([])
    expect(r.kjn).toBeNull()
  } finally {
    g.host.dispose()
  }
})

test('toLobby does nothing before the match is over', async () => {
  const g = await hostIn(playingState())
  try {
    g.host.toLobby()
    // A later host operation runs after it in the same queue.
    g.host.setOption('info', true)
    await until(() => g.room().opts?.info === true)
    expect(g.room().pub!.phase).not.toBe('LOBBY')
  } finally {
    g.host.dispose()
  }
})

test('after toLobby the host can reseat, a new player can join and a match starts', async () => {
  const { final } = finishedMatch(4)
  const g = await hostIn(final)
  try {
    g.host.toLobby()
    await until(() => g.room().pub!.phase === 'LOBBY')
    await g.send('p4', { kind: 'join', name: 'Cas' })
    expect(g.room().seats[3]).toMatchObject({ uid: 'p4', name: 'Cas', bot: false })
    g.host.swapSeats(1, 2)
    await until(() => g.room().seats[1]?.uid === 'bot:2')
    expect(g.room().seats[2]?.uid).toBe('p1')
    g.host.startGame()
    await until(() => g.room().pub!.phase !== 'LOBBY')
    expect(g.room().pub!.phase).toBe('DEALER_DRAW')
  } finally {
    g.host.dispose()
  }
})

test('a host reload republishes a lobby that the room doc missed', async () => {
  const { final } = finishedMatch(5)
  // The engine was saved in the lobby, but the room doc write failed.
  const g = await hostIn(createMatch(1), final)
  try {
    expect(g.room().pub!.phase).toBe('LOBBY')
  } finally {
    g.host.dispose()
  }
})
