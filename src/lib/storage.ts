export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// With cookies blocked, even reading the localStorage property throws.
function local(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** `JSON.parse` that gives `fallback` for missing or broken text. The caller
 *  checks the shape: a stored value can be any JSON. */
export function parseJson<T>(json: string | null, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback
  } catch {
    return fallback
  }
}

/** The JSON value at `key`, or `fallback` when it is missing, broken, or the
 *  store throws (a custom store may). */
export function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    return parseJson(store.getItem(key), fallback)
  } catch {
    return fallback
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
