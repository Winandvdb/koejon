/**
 * End-to-end test against the Firebase Emulator Suite.
 * Requires: `firebase emulators:start` (or use `firebase emulators:exec "npm run e2e"`).
 * Skipped automatically when no emulator is reachable on 127.0.0.1:8180.
 */
import { createConnection } from 'node:net'
import { describe, expect, test } from 'vitest'
import { botAction } from '../src/bots/bot'
import { app, signIn } from '../src/lib/firebase'
import { HostGame } from '../src/lib/host'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../src/lib/firebase'
import { parseKjn, type GameDoc } from '../src/lib/kjn'
import { handRef, newGameRef, roomRef } from '../src/lib/link-firestore'
import type { RoomDoc } from '../src/lib/net-types'
import { createRoom, type SessionView } from '../src/lib/room'

function emulatorUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({
      host: '127.0.0.1',
      port: Number(process.env.VITE_EMULATOR_FIRESTORE_PORT || 8180),
    })
    sock.setTimeout(1000)
    sock.on('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.on('error', () => resolve(false))
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Number of `games` docs, read past the rules with the emulator's owner token. */
async function gameCount(): Promise<number> {
  const port = Number(process.env.VITE_EMULATOR_FIRESTORE_PORT || 8180)
  const url = `http://127.0.0.1:${port}/v1/projects/${app.options.projectId}/databases/(default)/documents/games?pageSize=1000`
  const res = await fetch(url, { headers: { Authorization: 'Bearer owner' } })
  const body = (await res.json()) as { documents?: unknown[] }
  return body.documents?.length ?? 0
}

async function denied(p: Promise<unknown>): Promise<boolean> {
  try {
    await p
    return false
  } catch (e) {
    return (e as { code?: string }).code === 'permission-denied'
  }
}

async function until(fn: () => boolean, timeout = 120_000): Promise<void> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('e2e timeout')
    await sleep(60)
  }
}

describe('emulator e2e', () => {
  test('host + 3 bots play a full match to GAME_OVER', async (ctx) => {
    if (!(await emulatorUp())) {
      // CI sets this: there a missing emulator is a broken pipeline, not a skip.
      if (process.env.E2E_REQUIRED === 'true') throw new Error('Firestore emulator not reachable')
      return ctx.skip()
    }

    const uid = await signIn()
    const gamesBefore = await gameCount()
    const session = await createRoom(uid, 'Host')
    const uploads: GameDoc[] = []
    const link = session.hostLink!
    const save = link.saveGame!.bind(link)
    link.saveGame = (g) => {
      uploads.push(g)
      return save(g)
    }
    const saved = new Map<string, string>()
    let commits = 0
    const host = await HostGame.attach(session.code, uid, link, {
      botDelay: () => 5,
      heartbeatMs: 60_000,
      drawLingerMs: 20,
      bidLingerMs: 20,
      storage: {
        getItem: (k) => saved.get(k) ?? null,
        setItem: (k, v) => void saved.set(k, v),
        removeItem: (k) => void saved.delete(k),
      },
      onCommit: () => commits++,
    })

    let latest: SessionView | null = null
    let sentFor = -1
    let lastTry = 0
    // Drive the host's own seat with the same bot policy whenever it is our turn.
    const maybeSend = () => {
      const v = latest
      const pub = v?.room?.pub
      if (!v || !pub || v.mySeat < 0 || !v.state) return
      if (pub.phase === 'LOBBY') return
      if (!pub.actionSeats.includes(v.mySeat)) return
      // Same version: retry only via the resend interval — a dropped intent does
      // not bump the version, so a stale send must be retried to make progress.
      if (v.room!.version === sentFor && Date.now() - lastTry < 1500) return
      let a
      try {
        a = botAction(v.state, v.mySeat)
      } catch (e) {
        console.warn('[e2e] botAction threw:', e, 'hand=', v.hand)
        return
      }
      sentFor = v.room!.version
      lastTry = Date.now()
      console.log(`[e2e] seat ${v.mySeat} v${v.room!.version} sends`, JSON.stringify(a))
      host.submit({ kind: 'act', action: a })
    }
    const unsub = session.view.subscribe((v) => {
      latest = v
      maybeSend()
    })
    // Safety net: retry in case a snapshot edge raced a stale hand doc.
    const resend = setInterval(maybeSend, 2000)
    const progress = setInterval(() => {
      const pub = latest?.room?.pub
      if (pub) {
        console.log(
          `[e2e] phase=${pub.phase} hand=${pub.handNumber} lines=${pub.lines} turn=${pub.turn}`,
        )
      }
    }, 5000)

    try {
      host.addBot(1)
      host.addBot(2)
      host.addBot(3)
      await until(() => !!latest?.room && latest.room.seats.every((s) => s !== null), 10_000)

      host.startGame()

      await until(() => latest?.room?.pub?.phase === 'GAME_OVER', 240_000)

      const pub = latest!.room!.pub!
      expect(pub.winner).not.toBeNull()
      expect(pub.lines[pub.winner!]).toBe(0)
      expect(pub.handNumber).toBeGreaterThan(0)
      // Bot acks ride along in the commit that caused them: ~34 per hand, not ~55.
      const perHand = commits / pub.handNumber
      expect(perHand).toBeLessThan(42)
      // Engine state stays on the host device; the write-only bot-hands doc is gone.
      expect(saved.has(`koejon-engine-${session.code}`)).toBe(true)
      expect((await getDoc(handRef(session.code, 'host'))).exists()).toBe(false)
      // Host + bots only: the host's view is fed in-tab, so Firestore saw the
      // lobby writes (3 bots, start) and nothing per card.
      const fsRoom = (await getDoc(roomRef(session.code))).data() as RoomDoc
      expect(fsRoom.version).toBeLessThan(10)
      expect(fsRoom.pub?.phase).not.toBe('LOBBY')
      // The finished match landed as exactly one games doc, accepted by the rules.
      await until(() => !saved.has(`koejon-kjn-${session.code}`), 10_000)
      expect(uploads).toHaveLength(1)
      expect(await gameCount()).toBe(gamesBefore + 1)
      const rec = parseKjn(uploads[0].kjn)
      expect(rec.hands).toHaveLength(pub.handNumber)
      expect(rec.seats).toEqual(['human', 'bot-normal', 'bot-normal', 'bot-normal'])
      expect(JSON.stringify(uploads[0])).not.toContain(uid)
      expect(JSON.stringify(uploads[0])).not.toContain(session.code)
      console.log(
        `[e2e] match done: winner=team${pub.winner}, hands=${pub.handNumber}, lines=${pub.lines}, commits/hand=${perHand.toFixed(1)}`,
      )
    } finally {
      clearInterval(progress)
      clearInterval(resend)
      unsub()
      host.dispose()
      session.dispose()
    }
  }, 300_000)

  test('games rules: create only a well-formed record, nothing else', async (ctx) => {
    if (!(await emulatorUp())) {
      if (process.env.E2E_REQUIRED === 'true') throw new Error('Firestore emulator not reachable')
      return ctx.skip()
    }
    await signIn()
    const kjn = '[Format "KJN/1"]\n[App "test"]\n[Seats "human human human human"]\n'
    const good: GameDoc = {
      format: 'KJN/1',
      app: 'test',
      seats: ['human', 'human', 'human', 'human'],
      winner: 0,
      hands: 1,
      kjn,
    }
    const ref = newGameRef()
    await setDoc(ref, good)
    expect(await denied(getDoc(ref))).toBe(true)
    expect(await denied(updateDoc(ref, { winner: 1 }))).toBe(true)
    expect(await denied(deleteDoc(ref))).toBe(true)
    expect(await denied(setDoc(newGameRef(), { ...good, room: 'ABCDE' }))).toBe(true)
    expect(await denied(setDoc(newGameRef(), { ...good, format: 'KJN/2' }))).toBe(true)
    expect(await denied(setDoc(newGameRef(), { ...good, seats: ['human', 'x', 'human', 'human'] }))).toBe(true)
    expect(await denied(setDoc(newGameRef(), { ...good, kjn: kjn + 'x'.repeat(40_000) }))).toBe(true)
    expect(await denied(setDoc(doc(db, 'games', 'x'), { ...good, kjn: 'hello' }))).toBe(true)
  }, 30_000)
})
