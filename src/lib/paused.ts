import type { Phase } from '../engine'
import { safeStorage, type KeyValueStore } from './storage'

const KEY = 'koejon-paused'

/** Between the start and GAME_OVER: a host who leaves pauses the match
 *  instead of ending it. */
export const pausable = (phase: Phase | undefined): boolean =>
  !!phase && phase !== 'LOBBY' && phase !== 'GAME_OVER'

/** The one multiplayer room this device hosts and left mid-match. Only the
 *  host sets it, so a guest's Home never offers a resume. A paused solo match
 *  needs no marker: its save (`soloPaused`) says it all. */
export const pausedRoom = {
  get: (storage: KeyValueStore = safeStorage): string | null => storage.getItem(KEY),
  set: (code: string, storage: KeyValueStore = safeStorage): void => storage.setItem(KEY, code),
  clear: (storage: KeyValueStore = safeStorage): void => storage.removeItem(KEY),
}
