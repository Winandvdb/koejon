import { get } from 'svelte/store'
import { describe, expect, test } from 'vitest'
import { usage } from '../src/lib/fs'
import { botAction } from '../src/bots/bot'
import { HostGame, type HostOptions } from '../src/lib/host'
import { QUOTES } from '../src/lib/quotes'
import { localLinks, SOLO_CODE, type KeyValueStore } from '../src/lib/link-local'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import { safeStorage } from '../src/lib/storage'
import { blockStorage, memoryStore, until } from './helpers'

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
) {
  const links = localLinks(UID, storage, fresh ? newRoomDoc(SOLO_CODE, UID, 'Me') : undefined)!
  const session = new RoomSession(SOLO_CODE, UID, links.guest, links.host)
  const host = await HostGame.attach(SOLO_CODE, UID, links.host, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
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
    if (drive && pub.actionSeats.includes(v.mySeat)) host.submit(deepProxy({ kind: 'act', action: botAction(v.state, v.mySeat) }))
  })
  const close = () => {
    unsub()
    host.dispose()
    session.dispose()
  }
  return { host, view: () => latest, close }
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
    expect(storage.getItem(`koejon-engine-${SOLO_CODE}`)).toBeNull()
    // A whole solo match, reload included, never touched Firestore.
    expect(get(usage)).toEqual({ reads: 0, writes: 0 })
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
    const storage = memoryStore()
    const first = await open(storage, true)
    await expect(open(storage, false)).rejects.toThrow('host-elsewhere')
    first.close()
  }, 10_000)

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
