import type { HandDoc, Intent, RoomDoc } from './net-types'
import { readJson, type KeyValueStore } from './storage'
import type { GuestEvents, GuestLink, HostLink } from './transport'

/** Room code of the one offline solo room per browser. */
export const SOLO_CODE = 'SOLO'

const KEY = 'koejon-solo'

interface Saved {
  room: RoomDoc
  hand: HandDoc | null
}

/**
 * Host and guest in the same tab, no network: publish feeds the session
 * directly. Room and hand are kept in `storage` so a reload resumes.
 * Pass `room` to start a new solo room; omit it to resume the saved one.
 */
export function localLinks(
  uid: string,
  storage: KeyValueStore,
  room?: RoomDoc,
): { host: HostLink; guest: GuestLink } | null {
  let saved: Saved | null = room ? { room, hand: null } : read(storage)
  if (!saved) return null
  let events: GuestEvents | null = null
  let intentCb: ((uid: string, intent: Intent) => Promise<void>) | null = null
  const save = () => {
    try {
      if (saved) storage.setItem(KEY, JSON.stringify(saved))
      else storage.removeItem(KEY)
    } catch {
      // Storage full or blocked: only reload recovery is lost.
    }
  }
  save()

  const host: HostLink = {
    load: async () => saved?.room ?? null,
    onIntent: (cb) => {
      intentCb = cb
    },
    publish: async (update, hands) => {
      if (!saved) throw new Error('room-not-found')
      saved = { room: { ...saved.room, ...update, heartbeat: Date.now() }, hand: hands.get(uid) ?? null }
      save()
      events?.state(saved.room, saved.hand)
    },
    heartbeat: () => {},
    destroy: async () => {
      saved = null
      save()
      events?.room(null)
    },
    dispose: () => {
      intentCb = null
    },
  }

  const guest: GuestLink = {
    start: (ev) => {
      events = ev
      if (saved) ev.state(saved.room, saved.hand)
      else ev.room(null)
    },
    send: async (intent) => {
      if (!intentCb) throw new Error('host-not-attached')
      await intentCb(uid, intent)
    },
    dispose: () => {
      events = null
    },
  }

  return { host, guest }
}

const read = (storage: KeyValueStore) => readJson<Saved | null>(storage, KEY, null)
