import { afterEach, describe, expect, test, vi } from 'vitest'
import { TROEFKE_CHANCE } from '../src/bots/bot'
import { toPublic } from '../src/engine'
import { HostGame } from '../src/lib/host'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import type { RoomDoc } from '../src/lib/net-types'
import { newRoomDoc } from '../src/lib/room'
import { C, memoryStore, mulberry, playingState, until } from './helpers'

const UID = 'me'
const TRIALS = 1000

afterEach(() => {
  vi.restoreAllMocks()
})

/** One hand start through the real host: bot 1 bid with a strong trump hand,
 *  its bot partner 3 leads. Returns whether bot 1 asked troefke. */
async function bidderAsks(): Promise<boolean> {
  const hands = [
    [C('C', 'J'), C('C', 'Q'), C('D', 'J'), C('D', 'Q'), C('S', 'J'), C('S', 'Q')],
    [C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')],
    [C('C', 'K'), C('C', 'A'), C('D', 'K'), C('D', 'A'), C('S', 'K'), C('S', 'A')],
    [C('H', '10'), C('H', 'Q'), C('H', 'A'), C('S', '10'), C('C', '10'), C('D', '10')],
  ]
  // The first leader is confirmed already; the others still owe their ack.
  const state = playingState({ bidder: 1, turn: 3, leader: 3, trickAcks: [3], hands })
  const storage = memoryStore()
  storage.setItem(`koejon-engine-${SOLO_CODE}`, JSON.stringify(state))
  const room: RoomDoc = {
    ...newRoomDoc(SOLO_CODE, UID, 'Me'),
    pub: toPublic(state),
  }
  room.seats = [
    room.seats[0],
    { uid: 'bot:1', name: 'B1', bot: true },
    { uid: 'bot:2', name: 'B2', bot: true },
    { uid: 'bot:3', name: 'B3', bot: true },
  ]
  let latest: RoomDoc | null = null
  const links = localLinks(UID, storage, room)!
  links.guest.start({
    room: (r) => (latest = r),
    hand: () => {},
    state: (r) => (latest = r),
    lost: () => {},
    hostStale: () => {},
  })
  const host = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    quoteRand: () => 1,
  })
  try {
    // The bidder is done once it confirmed, by ack or by troefke.
    await until(() => !!(latest as RoomDoc | null)?.pub?.trickAcks.includes(1))
    return (latest as RoomDoc | null)!.pub!.troefkeAsked
  } finally {
    host.dispose()
  }
}

describe('host troefke decision', () => {
  test('a bidder bot decides troefke once per hand', async () => {
    // Seeded: the host's bots roll Math.random.
    vi.spyOn(Math, 'random').mockImplementation(mulberry(41))
    let asked = 0
    for (let i = 0; i < TRIALS; i++) if (await bidderAsks()) asked++
    // Two rolls would give TROEFKE_CHANCE squared (0.81), far outside this margin.
    expect(Math.abs(asked / TRIALS - TROEFKE_CHANCE)).toBeLessThan(0.03)
  }, 60_000)
})
