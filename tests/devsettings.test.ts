import { afterEach, describe, expect, test, vi } from 'vitest'
import { botAction } from '../src/bots/bot'
import type { Action } from '../src/engine'
import { DEV_DEFAULTS, parseDev, type DevSettings } from '../src/lib/devsettings'
import { HostGame, type HostOptions } from '../src/lib/host'
import type { GameDoc } from '../src/lib/kjn'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import type { HostLink } from '../src/lib/transport'
import { memoryStore, until } from './helpers'

const UID = 'me'

/** A solo host with three bots and these dev settings. Our own seat plays the
 *  bot policy, except for the actions `click` refuses: those go to `refused`.
 *  Every finished record lands in `games`. */
async function solo(dev: Partial<DevSettings>, click: (a: Action) => boolean, opts: HostOptions = {}) {
  const storage = memoryStore()
  const games: GameDoc[] = []
  const links = localLinks(UID, storage, newRoomDoc(SOLO_CODE, UID, 'Me'))!
  const link: HostLink = { ...links.host, saveGame: async (_id, g) => void games.push(g) }
  const session = new RoomSession(SOLO_CODE, UID, links.guest, link)
  const host = await HostGame.attach(SOLO_CODE, UID, link, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dev: () => ({ ...DEV_DEFAULTS, ...dev }),
    ...opts,
  })
  host.onError = (e) => {
    throw e
  }
  let latest: SessionView | null = null
  const refused: Action[] = []
  const unsub = session.view.subscribe((v) => {
    latest = v
    const pub = v.room?.pub
    if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
    if (!pub.actionSeats.includes(v.mySeat)) return
    const a = botAction(v.state, v.mySeat)
    if (click(a)) host.submit({ kind: 'act', action: a })
    else refused.push(a)
  })
  host.addBot(1)
  host.addBot(2)
  host.addBot(3)
  host.startGame()
  const close = () => {
    unsub()
    host.dispose()
    session.dispose()
  }
  return { pub: () => latest?.room?.pub, room: () => latest?.room, games, storage, refused, close }
}

afterEach(() => vi.restoreAllMocks())

describe('dev settings', () => {
  test('a stored value keeps only valid fields', () => {
    expect(parseDev(null)).toEqual(DEV_DEFAULTS)
    expect(parseDev('not json')).toEqual(DEV_DEFAULTS)
    expect(parseDev('{"treeLength":0,"speed":3,"autoplay":"yes"}')).toEqual(DEV_DEFAULTS)
    expect(parseDev('{"treeLength":14}').treeLength).toBe(13)
    expect(
      parseDev('{"treeLength":2,"speed":"instant","skipSeen":true,"interactiveDraws":false,"autoplay":true}'),
    ).toEqual({ treeLength: 2, speed: 'instant', skipSeen: true, interactiveDraws: false, autoplay: true })
  })

  test('tree length 2: the match ends when the lines are gone, and no record is uploaded', async () => {
    const g = await solo({ treeLength: 2 }, () => true)
    await until(() => g.pub()?.phase === 'GAME_OVER')
    const pub = g.pub()!
    for (const team of [0, 1]) expect(pub.marks.filter((m) => m.team === team && m.t === 'line')).toHaveLength(2)
    expect(pub.lines[pub.winner!]).toBe(0)
    expect(g.room()!.kjn ?? null).toBeNull()
    expect(g.storage.getItem('koejon-games-pending')).toBeNull()
    expect(g.games).toEqual([])
    g.close()
  }, 30_000)

  test('bot speed divides the bot delay and both lingers', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const g = await solo({ speed: 5 }, () => true, { botDelay: () => 50, drawLingerMs: 100, bidLingerMs: 75 })
    await until(() => (g.pub()?.handNumber ?? 0) >= 1)
    g.close()
    const waits = new Set(spy.mock.calls.map((c) => c[1]))
    // 50 / 5, 100 / 5 (deal), 75 / 5 (after a bid or draw).
    for (const ms of [10, 20, 15]) expect(waits).toContain(ms)
    for (const ms of [50, 100, 75]) expect(waits).not.toContain(ms)
  }, 30_000)

  test('instant bot speed waits 0 ms', async () => {
    const g = await solo({ speed: 'instant' }, () => true, { botDelay: () => 60_000, drawLingerMs: 60_000, bidLingerMs: 60_000 })
    await until(() => (g.pub()?.handNumber ?? 0) >= 1)
    g.close()
  }, 30_000)

  test('skip Gezien: the host confirms for our seat, the table never waits on it', async () => {
    const g = await solo({ skipSeen: true }, (a) => a.type !== 'ack')
    await until(() => (g.pub()?.handNumber ?? 0) >= 2)
    expect(g.refused).toEqual([])
    g.close()
  }, 30_000)

  test('interactive card draws off: the dealer draw and the cut need no click', async () => {
    const g = await solo(
      { interactiveDraws: false },
      (a) => a.type !== 'draw' && a.type !== 'cut' && a.type !== 'chooseDealer',
    )
    // Several hands: each one has a cut, some by our seat.
    await until(() => (g.pub()?.handNumber ?? 0) >= 4)
    // Our seat was asked to draw or cut, and the host did it.
    expect(g.refused.some((a) => a.type === 'draw')).toBe(true)
    expect(g.refused.some((a) => a.type === 'cut')).toBe(true)
    g.close()
  }, 30_000)

  test('autoplay: a solo match runs to GAME_OVER without a click, and no record is uploaded', async () => {
    const g = await solo({ autoplay: true }, () => false)
    await until(() => g.pub()?.phase === 'GAME_OVER', 60_000)
    expect(g.games).toEqual([])
    expect(g.storage.getItem('koejon-games-pending')).toBeNull()
    g.close()
  }, 90_000)
})
