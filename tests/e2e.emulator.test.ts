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
import { deleteDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { parseKjn, type GameDoc } from '../src/lib/kjn'
import { gameRef, saveGame } from '../src/lib/games'
import { handRef, roomRef } from '../src/lib/link-firestore'
import type { RoomDoc } from '../src/lib/net-types'
import { createRoom, type SessionView } from '../src/lib/room'
import { memoryStore, until } from './helpers'

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
    const saved = memoryStore()
    let commits = 0
    const host = await HostGame.attach(session.code, uid, link, {
      saveGame: (id, g) => {
        uploads.push(g)
        return saveGame(id, g)
      },
      botDelay: () => 5,
      heartbeatMs: 60_000,
      drawLingerMs: 20,
      bidLingerMs: 20,
      dealLingerMs: 20,
      storage: saved,
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
      expect(saved.getItem(`koejon-engine-${session.code}`)).not.toBeNull()
      expect((await getDoc(handRef(session.code, 'host'))).exists()).toBe(false)
      // Host + bots only: the host's view is fed in-tab, so Firestore saw the
      // lobby writes (3 bots, start) and nothing per card.
      const fsRoom = (await getDoc(roomRef(session.code))).data() as RoomDoc
      expect(fsRoom.version).toBeLessThan(10)
      expect(fsRoom.pub?.phase).not.toBe('LOBBY')
      // The finished match landed as exactly one games doc, accepted by the rules.
      await until(() => saved.getItem('koejon-games-pending') === null, 10_000)
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

  test('games rules: write-once, size and format tag only', async (ctx) => {
    if (!(await emulatorUp())) {
      if (process.env.E2E_REQUIRED === 'true') throw new Error('Firestore emulator not reachable')
      return ctx.skip()
    }
    await signIn()
    const fresh = () => gameRef(crypto.randomUUID())
    const kjn = '[Format "KJN/1"]\n[App "test"]\n[Seats "human human human human"]\n'
    const good: GameDoc = {
      format: 'KJN/1',
      app: 'test',
      seats: ['human', 'human', 'human', 'human'],
      winner: 0,
      hands: 1,
      kjn,
    }
    const ref = fresh()
    await setDoc(ref, good)
    // Write-once: a second write of the same id (a retried upload) is denied.
    expect(await denied(setDoc(ref, good))).toBe(true)
    expect(await denied(getDoc(ref))).toBe(true)
    expect(await denied(updateDoc(ref, { winner: 1 }))).toBe(true)
    expect(await denied(deleteDoc(ref))).toBe(true)
    // Newer builds may add fields, seat kinds or a format version.
    await setDoc(fresh(), { ...good, format: 'KJN/2', seats: ['human', 'bot-pro', 'human', 'human'], extra: 1 })
    expect(await denied(setDoc(fresh(), { format: 'KJN/1' }))).toBe(true)
    expect(await denied(setDoc(fresh(), { ...good, format: 'v1' }))).toBe(true)
    expect(await denied(setDoc(fresh(), { ...good, kjn: 'x'.repeat(100_001) }))).toBe(true)
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`f${i}`, i]))
    expect(await denied(setDoc(fresh(), { ...good, ...many }))).toBe(true)
  }, 30_000)
})
