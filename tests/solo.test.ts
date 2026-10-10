import * as firestore from 'firebase/firestore'
import { describe, expect, test, vi } from 'vitest'
import { botAction } from '../src/bots/bot'
import { HostGame, type HostOptions } from '../src/lib/host'
import { QUOTES } from '../src/lib/quotes'
import { localLinks, SOLO_CODE, type KeyValueStore } from '../src/lib/link-local'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import { seededRandom } from '../src/lib/seed'
import { safeStorage } from '../src/lib/storage'
import { blockStorage, failLocks, memoryStore, until } from './helpers'

// Spies on every Firestore read and write the app uses, so a test can prove
// that solo never calls one.
vi.mock('firebase/firestore', async (importOriginal) => {
  const fs = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...fs,
    getDoc: vi.fn(fs.getDoc),
    setDoc: vi.fn(fs.setDoc),
    updateDoc: vi.fn(fs.updateDoc),
    deleteDoc: vi.fn(fs.deleteDoc),
    writeBatch: vi.fn(fs.writeBatch),
    onSnapshot: vi.fn(fs.onSnapshot),
  }
})

const UID = 'me'

/** What the UI hands over: Svelte `$state` wraps everything in proxies. */
function deepProxy<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v
  const copy = Array.isArray(v) ? v.map(deepProxy) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepProxy(x)]))
  return new Proxy(copy, {}) as T
}

async function open(
  storage: KeyValueStore,
  fresh: boolean,
  hostOpts: HostOptions = {},
  drive = true,
  ownRand: () => number = Math.random,
) {
  const links = localLinks(UID, storage, fresh ? newRoomDoc(SOLO_CODE, UID, 'Me') : undefined)!
  const session = new RoomSession(SOLO_CODE, UID, links.guest, links.host)
  const host = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dealLingerMs: 0,
    ...hostOpts,
  })
  host.onError = (e) => {
    throw e
  }
  // Drive our own seat with the bot policy whenever the table waits on us.
  let latest: SessionView | null = null
  const unsub = session.view.subscribe((v) => {
    latest = v
    const pub = v.room?.pub
    if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
    if (drive && pub.actionSeats.includes(v.mySeat))
      host.submit(deepProxy({ kind: 'act', action: botAction(v.state, v.mySeat, ownRand) }))
  })
  const close = () => {
    unsub()
    host.dispose()
    session.dispose()
  }
  return { host, session, view: () => latest, close }
}

describe('offline solo', () => {
  test('plays a full match, survives a reload mid-game', async () => {
    const storage = memoryStore()
    const first = await open(storage, true)
    first.host.addBot(1)
    first.host.addBot(2)
    first.host.addBot(3)
    first.host.startGame()
    await until(() => (first.view()?.room?.pub?.handNumber ?? 0) >= 2)
    first.close()

    // Reload: resume from storage only.
    const second = await open(storage, false)
    expect(second.view()?.room?.pub?.handNumber).toBeGreaterThanOrEqual(2)
    await until(() => second.view()?.room?.pub?.phase === 'GAME_OVER')
    const pub = second.view()!.room!.pub!
    expect(pub.winner).not.toBeNull()
    expect(pub.lines[pub.winner!]).toBe(0)

    await second.host.destroyRoom()
    second.close()
    expect(localLinks(UID, storage)).toBeNull()
    for (const key of ['engine', 'seq', 'quotes', 'seats', 'kjn', 'kjn-final']) {
      expect(storage.getItem(`koejon-${key}-${SOLO_CODE}`)).toBeNull()
    }
    // A whole solo match, reload included, never touched Firestore.
    const { getDoc, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot } = firestore
    for (const f of [getDoc, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot]) expect(f).not.toHaveBeenCalled()
  }, 60_000)

  test('plays on when the browser blocks localStorage', async () => {
    const restore = blockStorage()
    try {
      // As the app wires it: safeStorage for the room, the host's default for the engine.
      const g = await open(safeStorage, true, { storage: undefined })
      g.host.addBot(1)
      g.host.addBot(2)
      g.host.addBot(3)
      g.host.startGame()
      await until(() => (g.view()?.room?.pub?.handNumber ?? 0) >= 2)
      // Nothing was kept, so a reload has no game to resume.
      expect(localLinks(UID, safeStorage)).toBeNull()
      await g.host.destroyRoom()
      g.close()
    } finally {
      restore()
    }
  }, 30_000)

  test('a second host tab for the same room is refused', async () => {
    // The lock request times out: another tab holds it.
    const restore = failLocks('TimeoutError')
    try {
      await expect(open(memoryStore(), true)).rejects.toThrow('host-elsewhere')
    } finally {
      restore()
    }
  })

  /** Bot names and every card played in the first two hands. `toggle` flips a
   *  display option (an extra commit) whenever a bot is about to play. */
  async function playTwoHands(rand?: () => number, ownRand?: () => number, toggle = false): Promise<string[]> {
    const g = await open(memoryStore(), true, { rand }, true, ownRand)
    const log: string[] = []
    const seen = new Set<string>()
    const toggled = new Set<string>()
    const unsub = g.session.view.subscribe((v) => {
      const pub = v.room?.pub
      if (!pub || pub.handNumber > 2) return
      const botToPlay = pub.phase === 'PLAYING' && pub.actionSeats.some((s) => v.room!.seats[s]?.bot)
      const at = `${pub.handNumber}/${pub.tricksPlayed}/${pub.trick.length}`
      if (toggle && botToPlay && !toggled.has(at)) {
        toggled.add(at)
        g.host.setOption('score', toggled.size % 2 === 1)
      }
      for (const tc of pub.trick) {
        const key = `${pub.handNumber}/${pub.tricksPlayed}/${tc.seat}${tc.card.s}${tc.card.r}`
        if (seen.has(key)) continue
        seen.add(key)
        log.push(key)
      }
    })
    g.host.addBot(1)
    g.host.addBot(2)
    g.host.addBot(3)
    g.host.startGame()
    await until(() => (g.view()?.room?.pub?.handNumber ?? 0) >= 3)
    unsub()
    log.unshift(g.view()!.room!.seats.map((s) => s?.name).join(','))
    await g.host.destroyRoom()
    g.close()
    return log
  }

  test('a seeded host plays the same game every time', async () => {
    const a = await playTwoHands(seededRandom(1), seededRandom(99))
    const b = await playTwoHands(seededRandom(1), seededRandom(99))
    expect(a.length).toBeGreaterThan(10)
    expect(b).toEqual(a)
    // The host's seed decides it, not our own seat's moves.
    expect(await playTwoHands(seededRandom(2), seededRandom(99))).not.toEqual(a)
  }, 60_000)

  test('extra commits (a display toggle) do not change a seeded game', async () => {
    const plain = await playTwoHands(seededRandom(1), seededRandom(99))
    expect(await playTwoHands(seededRandom(1), seededRandom(99), true)).toEqual(plain)
  }, 60_000)

  test('without a seed, games differ', async () => {
    const a = await playTwoHands()
    const b = await playTwoHands()
    expect(b).not.toEqual(a)
  }, 60_000)

  test('fired quotes ride on the room doc, so every client sees the same', async () => {
    const g = await open(memoryStore(), true, { quoteRand: () => 0 })
    g.host.addBot(1)
    g.host.addBot(2)
    g.host.addBot(3)
    g.host.startGame()
    // With the roll pinned at 0 the first met condition fires at once.
    await until(() => (g.view()?.room?.quotes?.length ?? 0) > 0)
    const q = g.view()!.room!.quotes!.at(-1)!
    expect(q.n).toBeGreaterThan(0)
    expect(q.seat).toBeGreaterThanOrEqual(0)
    expect(q.at).toBeGreaterThan(0)
    await g.host.destroyRoom()
    g.close()
  }, 30_000)

  test('a stalled seat gets nagged through the room doc', async () => {
    // drive=false: our seat never acts, so the table stalls on it.
    const g = await open(memoryStore(), true, { quoteRand: () => 0, hurryMs: 50 }, false)
    g.host.addBot(1)
    g.host.addBot(2)
    g.host.addBot(3)
    g.host.startGame()
    await until(
      () => (g.view()?.room?.quotes ?? []).some((q) => (QUOTES.hurry as readonly string[]).includes(q.text)),
    )
    await g.host.destroyRoom()
    g.close()
  }, 30_000)
})
