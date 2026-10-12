import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readJson, safeStorage } from '../src/lib/storage'
import { blockStorage, memoryStore } from './helpers'

const thrower = () => {
  throw new DOMException('Quota exceeded', 'QuotaExceededError')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('readJson', () => {
  test('gives the stored value', () => {
    const store = memoryStore()
    store.setItem('k', '{"a":1}')
    expect(readJson(store, 'k', null)).toEqual({ a: 1 })
  })

  test('gives the fallback for a missing or broken value', () => {
    const store = memoryStore()
    expect(readJson(store, 'k', [])).toEqual([])
    store.setItem('k', '{broken')
    expect(readJson(store, 'k', 'fallback')).toBe('fallback')
  })

  test('gives the fallback when the store throws', () => {
    expect(readJson({ getItem: thrower, setItem: thrower, removeItem: thrower }, 'k', 7)).toBe(7)
  })

  test('gives the fallback when storage is blocked', () => {
    const restore = blockStorage()
    try {
      expect(readJson(safeStorage, 'k', 'fallback')).toBe('fallback')
    } finally {
      restore()
    }
  })
})

describe('blocked storage', () => {
  test('safeStorage reads empty and drops writes when the property throws', () => {
    const restore = blockStorage()
    try {
      expect(() => safeStorage.setItem('k', 'v')).not.toThrow()
      expect(safeStorage.getItem('k')).toBeNull()
      expect(() => safeStorage.removeItem('k')).not.toThrow()
    } finally {
      restore()
    }
  })

  test('safeStorage survives when every storage call throws', () => {
    vi.stubGlobal('localStorage', { getItem: thrower, setItem: thrower, removeItem: thrower })
    expect(() => safeStorage.setItem('k', 'v')).not.toThrow()
    expect(safeStorage.getItem('k')).toBeNull()
    expect(() => safeStorage.removeItem('k')).not.toThrow()
  })

  test('theme and prefs load without storage and without matchMedia', async () => {
    const restore = blockStorage()
    try {
      // A DOM without matchMedia (old browsers).
      vi.stubGlobal('document', { documentElement: { dataset: {} } })
      const { theme } = await import('../src/lib/theme')
      expect(get(theme)).toBe('light')
      expect(() => theme.set('dark')).not.toThrow()
      const { sortMode } = await import('../src/lib/prefs')
      expect(get(sortMode)).toBeNull()
      expect(() => sortMode.set('high')).not.toThrow()
      const { lang, botLevel, playerName } = await import('../src/lib/prefs')
      expect(get(lang)).toBe('nl')
      expect(get(botLevel)).toBe('normal')
      expect(() => lang.set('en')).not.toThrow()
      expect(() => botLevel.set('hard')).not.toThrow()
      expect(() => playerName.set('Jef')).not.toThrow()
    } finally {
      restore()
    }
  })
})
