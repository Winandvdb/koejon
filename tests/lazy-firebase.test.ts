import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'

// The start path must never pull the Firebase SDK in: a static import of one
// of these modules from it would throw here.
vi.mock('firebase/app', () => {
  throw new Error('firebase must load lazily')
})
vi.mock('firebase/auth', () => {
  throw new Error('firebase must load lazily')
})
vi.mock('firebase/firestore', () => {
  throw new Error('firebase must load lazily')
})

describe('lazy firebase', () => {
  test('the room module loads without Firebase', async () => {
    const room = await import('../src/lib/room')
    expect(room.CODE_LENGTH).toBeGreaterThan(0)
  })

  test('the app shell has no static Firebase import', () => {
    const src = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8')
    // A static import starts a line with `import` and no `(`: dynamic
    // `import('...')` calls never match.
    expect(src).not.toMatch(/^import[^(']*firebase/im)
  })
})
