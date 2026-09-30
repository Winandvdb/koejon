import { writable } from 'svelte/store'

const KEY = 'koejon-sort'

function load(): boolean {
  try {
    // On by default — only an explicit '0' turns sorting off.
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

/** Per-player preference: sort the own hand by suit, high to low. */
export const sortHand = writable<boolean>(load())

sortHand.subscribe((v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    // Preferences just won't persist.
  }
})
