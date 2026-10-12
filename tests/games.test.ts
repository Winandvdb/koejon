import { beforeEach, describe, expect, test, vi } from 'vitest'
import { saveGame } from '../src/lib/games'
import type { GameDoc } from '../src/lib/kjn'

const fake = vi.hoisted(() => ({
  writes: [] as { path: string; data: unknown }[],
  user: null as { uid: string } | null,
  signIns: 0,
}))
vi.mock('../src/lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return fake.user
    },
  },
  signIn: async () => {
    fake.signIns++
    fake.user = { uid: 'u' }
    return 'u'
  },
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  setDoc: async (ref: { path: string }, data: unknown) => void fake.writes.push({ path: ref.path, data }),
}))

const GAME = { kjn: 'KJN/1' } as unknown as GameDoc

describe('saveGame', () => {
  beforeEach(() => {
    fake.writes = []
    fake.user = { uid: 'u' }
    fake.signIns = 0
  })

  test('writes one games/{id} doc', async () => {
    await saveGame('abc', GAME)
    expect(fake.writes).toEqual([{ path: 'games/abc', data: GAME }])
    expect(fake.signIns).toBe(0)
  })

  test('signs in first when a solo match started offline', async () => {
    fake.user = null
    await saveGame('abc', GAME)
    expect(fake.signIns).toBe(1)
    expect(fake.writes).toHaveLength(1)
  })
})
