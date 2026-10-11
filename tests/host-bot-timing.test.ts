import { afterEach, describe, expect, test, vi } from 'vitest'
import { toPublic } from '../src/engine'
import type { State } from '../src/engine'
import { HostGame } from '../src/lib/host'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import type { RoomDoc } from '../src/lib/net-types'
import { newRoomDoc } from '../src/lib/room'
import { C, memoryStore, playingState } from './helpers'

// Every real bot decision takes THINK_MS: a slow search that blocks the page.
const { THINK_MS } = vi.hoisted(() => ({ THINK_MS: 800 }))
vi.mock('../src/bots/bot', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/bots/bot')>()
  const { legalActions } = await import('../src/engine')
  return {
    ...real,
    botAction: (...args: Parameters<typeof real.botAction>) => {
      const a = real.botAction(...args)
      if (legalActions(args[0], args[1]).length > 1) vi.setSystemTime(Date.now() + THINK_MS)
      return a
    },
  }
})

const UID = 'me'

afterEach(() => {
  vi.useRealTimers()
})

/** A host on `state`, seat 0 human, seats 1 to 3 bots. `published` holds the
 *  time of every landed commit with the state then. */
async function host(state: State, opts: { botDelay: number; bidLingerMs: number }) {
  const storage = memoryStore()
  storage.setItem(`koejon-engine-${SOLO_CODE}`, JSON.stringify(state))
  const room: RoomDoc = { ...newRoomDoc(SOLO_CODE, UID, 'Me'), pub: toPublic(state) }
  room.seats = [room.seats[0], ...[1, 2, 3].map((i) => ({ uid: `bot:${i}`, name: `B${i}`, bot: true }))]
  let latest: RoomDoc | null = null
  const links = localLinks(UID, storage, room)!
  links.guest.start({
    room: (r) => (latest = r),
    hand: () => {},
    state: (r) => (latest = r),
    lost: () => {},
    hostStale: () => {},
  })
  const published: { at: number; pub: NonNullable<RoomDoc['pub']> }[] = []
  const h = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => opts.botDelay,
    drawLingerMs: 0,
    bidLingerMs: opts.bidLingerMs,
    dealLingerMs: 0,
    quoteRand: () => 1,
    rand: () => 0.99,
    onCommit: () => published.push({ at: Date.now(), pub: (latest as RoomDoc | null)!.pub! }),
  })
  return { h, published }
}

const hands = [
  [C('C', 'J'), C('C', 'Q'), C('D', 'J'), C('D', 'Q'), C('S', 'J'), C('S', 'Q')],
  // The bidder holds one trump: no troefke hand, so it acks.
  [C('H', '9'), C('S', '9'), C('S', 'K'), C('C', '9'), C('D', '9'), C('D', 'K')],
  [C('C', 'K'), C('C', 'A'), C('D', 'A'), C('S', 'A'), C('S', '10'), C('C', '10')],
  [C('H', '10'), C('H', 'Q'), C('H', 'A'), C('H', 'J'), C('H', 'K'), C('D', '10')],
]

describe('host bot timing (#172)', () => {
  test('a slow bot thinks during its pause: the card lands after the pause, not pause plus search', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const { h, published } = await host(playingState({ bidder: 1, turn: 1, leader: 1, hands }), {
      botDelay: 1000,
      bidLingerMs: 0,
    })
    try {
      const played = () => published.find((p) => p.pub.trick.length === 1)
      for (let i = 0; i < 300 && !played(); i++) await vi.advanceTimersByTimeAsync(10)
      // The 800 ms search fits in the 1000 ms pause.
      expect(played()!.at - t0).toBeGreaterThanOrEqual(1000)
      expect(played()!.at - t0).toBeLessThan(1000 + 100)
    } finally {
      h.dispose()
    }
  })

  test("the bidder's ack shows the bid first and does not start the bid pause again", async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    // The bid just ended: partner 3 leads, the others still owe their "seen it".
    const state = playingState({
      bidder: 1,
      turn: 3,
      leader: 3,
      trickAcks: [3],
      hands,
      log: [{ t: 'play-call', seat: 1, suit: 'H' }],
    })
    const { h, published } = await host(state, { botDelay: 500, bidLingerMs: 2000 })
    try {
      const at = (f: (p: (typeof published)[number]) => boolean) => published.find(f)?.at
      for (let i = 0; i < 100 && at((p) => p.pub.trickAcks.includes(1)) === undefined; i++) {
        await vi.advanceTimersByTimeAsync(10)
      }
      // The bid was published before the bidder's search, and the search ran at once.
      expect(published[0].pub.trickAcks).not.toContain(1)
      expect(at((p) => p.pub.trickAcks.includes(1))! - t0).toBeLessThan(THINK_MS + 100)
      // The human confirms 1 s after the bid.
      await vi.advanceTimersByTimeAsync(Math.max(0, t0 + 1000 - Date.now()))
      h.submit({ kind: 'act', action: { type: 'ack', seat: 0 } })
      for (let i = 0; i < 300 && at((p) => p.pub.trick.length === 1) === undefined; i++) {
        await vi.advanceTimersByTimeAsync(10)
      }
      // The lead comes 2 s after the bid, not 2 s after the last ack.
      const lead = at((p) => p.pub.trick.length === 1)! - t0
      expect(lead).toBeGreaterThanOrEqual(2000)
      expect(lead).toBeLessThan(2000 + 100)
    } finally {
      h.dispose()
    }
  })
})
