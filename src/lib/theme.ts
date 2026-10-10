import { writable } from 'svelte/store'
import { safeStorage } from './storage'

export type Theme = 'light' | 'dark'
const KEY = 'koejon-theme'

function load(): Theme {
  const saved = safeStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  // Blocked storage, old browsers and Node: the OS preference, if there is one.
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const theme = writable<Theme>(load())

theme.subscribe((v) => {
  document.documentElement.dataset.theme = v
  safeStorage.setItem(KEY, v)
})
