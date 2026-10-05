// Service worker template. The build (pwa/precache.ts) replaces the
// placeholder below with { version, files } of the current deploy.
const { version, files } = self.__PRECACHE__
const CACHE = `koejon-${version}`

// Precache the whole app shell on install, so the next start works offline
// even for files this visit never requested.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(files)).then(() => self.skipWaiting()))
})

// A new deploy takes over right away and drops the old caches.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('koejon-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Page loads: network first so a new deploy shows up on the next start; the
// cached shell when offline or the network hangs.
const NAV_TIMEOUT_MS = 3000

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // Firebase, signaling and other origins: never touch.
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(navigate(req))
    return
  }
  // Hashed assets never change: cache first.
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
})

async function navigate(req) {
  try {
    return await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ])
  } catch {
    return (await caches.match('/')) ?? Response.error()
  }
}
