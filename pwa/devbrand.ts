import { readFileSync } from 'node:fs'

/**
 * Dev channel branding: a build with VITE_SHOW_USAGE=true (the develop
 * deploy workflow sets it job-wide) swaps the app name and icons so an
 * installed dev app stands apart from the live one.
 */

/** Splash/status-bar colour of the dev build (amber, live is #1d6b45). */
export const DEV_COLOR = '#b45309'
export const DEV_NAME = 'Koejonnen DEV'
export const DEV_SHORT_NAME = 'Koejon DEV'

/** Dev files emitted into dist only on dev builds: dist name -> source path. */
export const DEV_FILES: Record<string, string> = {
  'manifest-dev.webmanifest': '',
  'icon-dev.svg': 'pwa/dev/icon-dev.svg',
  'icon-dev-192.png': 'pwa/dev/icon-dev-192.png',
  'icon-dev-512.png': 'pwa/dev/icon-dev-512.png',
  'apple-touch-icon-dev.png': 'pwa/dev/apple-touch-icon-dev.png',
}

export function devManifest(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    name: DEV_NAME,
    short_name: DEV_SHORT_NAME,
    theme_color: DEV_COLOR,
    background_color: DEV_COLOR,
    icons: [
      { src: '/icon-dev-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-dev-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-dev-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-dev.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}

/** Points index.html at the dev manifest, dev icons and dev name. */
export function devIndexHtml(html: string): string {
  return html
    .replace('<title>Koejonnen</title>', `<title>${DEV_SHORT_NAME}</title>`)
    .replace('content="#1d6b45"', `content="${DEV_COLOR}"`)
    .replace('href="/manifest.webmanifest"', 'href="/manifest-dev.webmanifest"')
    .replace('href="/icon.svg"', 'href="/icon-dev.svg"')
    .replace('href="/apple-touch-icon.png"', 'href="/apple-touch-icon-dev.png"')
    .replace('name="apple-mobile-web-app-title" content="Koejon"', `name="apple-mobile-web-app-title" content="${DEV_SHORT_NAME}"`)
}

/** Contents of every dev file: dist name -> file content to emit. */
export function devFiles(): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {}
  for (const [name, path] of Object.entries(DEV_FILES)) {
    out[name] =
      name === 'manifest-dev.webmanifest'
        ? JSON.stringify(devManifest(JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))))
        : readFileSync(path)
  }
  return out
}
