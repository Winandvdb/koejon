import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { devFiles, devIndexHtml } from './pwa/devbrand.ts'
import { swSource } from './pwa/precache.ts'

/**
 * Dev builds (VITE_APP_VARIANT=dev: the dev channel and previews of PRs into
 * develop) get their own manifest, name and icons so an installed dev app
 * stands apart from the live one. Runs before serviceWorker so the emitted
 * files land in the precache list.
 */
function devBranding(): Plugin {
  const dev = process.env.VITE_APP_VARIANT === 'dev'
  return {
    name: 'koejon-dev-brand',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: dev ? (html) => devIndexHtml(html) : undefined,
    generateBundle() {
      if (!dev) return
      for (const [name, content] of Object.entries(devFiles())) {
        this.emitFile({ type: 'asset', fileName: name, source: content })
      }
    },
  }
}

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
  plugins: [svelte(), devBranding(), serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
