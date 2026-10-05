---
id: task-14
title: Make the app an installable PWA
status: In Progress
assignee:
  - '@lab900-winand-vandenbergh'
created_date: '2026-10-05 08:11'
updated_date: '2026-10-05 10:23'
labels:
  - pwa
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let players install Koejon on their phone home screen, so it opens like a native app (full screen, own icon) instead of a browser tab. The app has no web app manifest or service worker yet.

Solo play with bots already runs fully local (src/lib/link-local.ts: host, bots and state in the same tab and localStorage, no Firestore or P2P), so it should also work offline. Today App.svelte waits for the anonymous Firebase sign-in at startup and stops with an offline error when it fails, which also blocks solo play. Multiplayer rooms need Firestore and stay online-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app can be installed from Chrome on Android and from Safari on iOS (Add to Home Screen)
- [ ] #2 The installed app has its own name, icon and splash colour, and opens full screen without browser bars
- [ ] #3 The app shell loads quickly on repeat visits
- [ ] #4 A player can start and play a solo game with bots without a network connection, also on the first visit after install
- [ ] #5 Offline, the multiplayer options are disabled or show a clear message instead of a browser error page
- [ ] #6 After a new deploy, players get the new version without a manual cache clear

- [ ] #7 Lighthouse reports the app as installable
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add public/manifest.webmanifest (name, short_name, standalone, theme/background colour, 192/512/maskable PNG icons + SVG) and link it plus apple-touch-icon and iOS meta tags in index.html -> check: build copies files to dist, manifest JSON valid (AC1, AC2, AC7)
2. Add a hand-written service worker: a small Vite plugin in vite.config.ts emits dist/sw.js with the list of built files and a version hash; precache on install, cache-first for assets, network-first (with timeout) for navigation, delete old caches on activate -> check: unit test for the precache list/version; build output contains sw.js (AC3, AC4, AC6)
3. Register the SW in main.ts (production only); serve sw.js and manifest with no-cache in firebase.json -> check: build passes (AC6)
4. App.svelte: fall back to a local uid when anonymous sign-in fails, so solo starts offline; retry sign-in on multiplayer click -> check: build + manual offline test (AC4)
5. Home.svelte: track navigator.onLine; offline disables create/join and shows a message (nl + en) -> check: build + manual offline test (AC5)
6. Run npm test and npm run build; manual checks for install on Android/iOS and Lighthouse -> check: both pass (AC1, AC2, AC7 manual)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added web app manifest + icons (public/), iOS meta tags (index.html), and a hand-written service worker (pwa/sw.js) that a small Vite plugin (vite.config.ts, pwa/precache.ts) emits as dist/sw.js with every built file and a content-hash version. Install precaches the shell; assets cache-first; navigation network-first with a 3 s timeout, cached shell offline; skipWaiting + clients.claim and old caches deleted on activate, so a deploy reaches players on the next start. firebase.json serves sw.js and the manifest with no-cache. App.svelte: when anonymous sign-in fails, use the last signed-in uid (koejon-uid) or a local id, so solo starts offline; multiplayer buttons retry sign-in. Home.svelte: offline disables create/join and shows a note (nl + en). Tests: tests/pwa.test.ts (precache list, version, manifest fields, icon files). npm test and npm run build pass. Manual: install on Android Chrome and iOS Safari, offline solo after install, offline home screen, update after deploy, Lighthouse installable. Note: iOS home screen apps have their own storage, so the very first launch of the installed iOS app needs a network once.
<!-- SECTION:NOTES:END -->
