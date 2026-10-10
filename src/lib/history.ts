import { parseKjn } from './kjn'
import { keepDropped } from './stats'
import { readJson, safeStorage, type KeyValueStore } from './storage'

/** Finished matches on this device only: never uploaded. */
export const HISTORY_KEY = 'koejon-history'
export const HISTORY_MAX = 20
const PERSIST_KEY = 'koejon-persist-asked'

export interface HistoryEntry {
  /** Random, local to this device. */
  id: string
  /** Epoch ms. */
  finishedAt: number
  /** The own seat, so a replay can show the match from this side. */
  seat: number
  /** Seat names as shown at the table. Not part of the KJN text. */
  names: string[]
  /** Canonical KJN/1 text, unchanged. */
  kjn: string
}

export function readHistory(store: KeyValueStore = safeStorage): HistoryEntry[] {
  const list = readJson<unknown>(store, HISTORY_KEY, [])
  return Array.isArray(list) ? (list as HistoryEntry[]) : []
}

/** Adds a finished match once; the oldest drops out when the list is full.
 *  False when it was already kept, is no valid record, or storage failed. */
export function addHistory(
  entry: Pick<HistoryEntry, 'seat' | 'names' | 'kjn'>,
  store: KeyValueStore = safeStorage,
  now = Date.now(),
): boolean {
  const list = readHistory(store)
  // The dealt cards make the text unique per match.
  if (list.some((e) => e.kjn === entry.kjn)) return false
  try {
    parseKjn(entry.kjn)
  } catch {
    return false
  }
  const item: HistoryEntry = {
    id: crypto.randomUUID(),
    finishedAt: now,
    seat: entry.seat,
    names: [...entry.names],
    kjn: entry.kjn,
  }
  const next = [...list, item]
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(next.slice(-HISTORY_MAX)))
  } catch {
    // Storage full or blocked: this match is not kept, the game goes on.
    return false
  }
  // After the list write: a failed write must not count a match twice.
  keepDropped(next.slice(0, -HISTORY_MAX), store)
  // The statistics live here too: ask the browser not to evict them. Only
  // once per device: Firefox shows a prompt for it.
  try {
    if (!store.getItem(PERSIST_KEY)) {
      store.setItem(PERSIST_KEY, '1')
      ;(globalThis.navigator as Navigator | undefined)?.storage?.persist?.().catch(() => {})
    }
  } catch {
    // Blocked storage: nothing to keep.
  }
  return true
}

export function removeHistory(id: string, store: KeyValueStore = safeStorage): void {
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(readHistory(store).filter((e) => e.id !== id)))
  } catch {
    // Blocked storage: nothing to remove.
  }
}
