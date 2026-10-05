import type { HandDoc, Intent, RoomDoc } from './net-types'
import type { GuestEvents, GuestLink, HostLink } from './transport'

/** Room code of the one offline solo room per browser. */
export const SOLO_CODE = 'SOLO'

const KEY = 'koejon-solo'

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

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
      events?.room(saved.room)
      events?.hand(saved.hand)
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
      ev.room(saved?.room ?? null)
      ev.hand(saved?.hand ?? null)
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

function read(storage: KeyValueStore): Saved | null {
  try {
    const json = storage.getItem(KEY)
    return json ? (JSON.parse(json) as Saved) : null
  } catch {
    return null
  }
}
