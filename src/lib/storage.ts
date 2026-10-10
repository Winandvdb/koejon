export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// With cookies blocked, even reading the localStorage property throws.
function local(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** localStorage that never throws: blocked or missing storage reads as empty
 *  and drops writes, so the app still starts and solo still plays. */
export const safeStorage: KeyValueStore = {
  getItem(k) {
    try {
      return local()?.getItem(k) ?? null
    } catch {
      return null
    }
  },
  setItem(k, v) {
    try {
      local()?.setItem(k, v)
    } catch {
      // Not persisted.
    }
  },
  removeItem(k) {
    try {
      local()?.removeItem(k)
    } catch {
      // Nothing to remove.
    }
  },
}
