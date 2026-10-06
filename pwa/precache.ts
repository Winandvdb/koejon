import { createHash } from 'node:crypto'

export interface Precache {
  version: string
  files: string[]
}

/**
 * Build output (path -> content) to the service worker's precache list.
 * The version hashes all contents, so every deploy that changes a file
 * installs a new worker and drops the old cache.
 */
export function precache(output: Record<string, string | Uint8Array>): Precache {
  const names = Object.keys(output)
    .filter((n) => n !== 'sw.js' && !n.endsWith('.map'))
    .sort()
  const hash = createHash('sha256')
  for (const n of names) hash.update(n).update('\0').update(output[n]).update('\0')
  return {
    version: hash.digest('hex').slice(0, 12),
    // The shell is cached as '/': that is what navigations fall back to.
    files: names.map((n) => (n === 'index.html' ? '/' : `/${n}`)),
  }
}

/** The worker template with the precache list filled in. */
export function swSource(template: string, output: Record<string, string | Uint8Array>): string {
  return template.replace('self.__PRECACHE__', JSON.stringify(precache(output)))
}
