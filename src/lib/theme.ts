import { writable } from 'svelte/store'

export type Theme = 'light' | 'dark'
const KEY = 'koejon-theme'

function load(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Private mode: fall through to the OS preference.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const theme = writable<Theme>(load())

theme.subscribe((v) => {
  document.documentElement.dataset.theme = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Preferences just won't persist.
  }
})
