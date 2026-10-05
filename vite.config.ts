import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { swSource } from './pwa/precache.ts'

/** Emits dist/sw.js with the list of every built file (installable PWA). */
function serviceWorker(): Plugin {
  return {
    name: 'koejon-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const output: Record<string, string | Uint8Array> = {}
      for (const [name, f] of Object.entries(bundle)) output[name] = f.type === 'chunk' ? f.code : f.source
      // public/ is copied as is and is not part of the bundle. Hosting skips
      // dotfiles, so the worker must not ask for them either.
      for (const d of readdirSync('public', { withFileTypes: true })) {
        if (d.isFile() && !d.name.startsWith('.')) output[d.name] = readFileSync(join('public', d.name))
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(readFileSync('pwa/sw.js', 'utf8'), output) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
