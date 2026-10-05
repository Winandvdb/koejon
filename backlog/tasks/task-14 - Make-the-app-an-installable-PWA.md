---
id: task-14
title: Make the app an installable PWA
status: To Do
assignee: []
created_date: '2026-10-05 08:11'
updated_date: '2026-10-05 08:25'
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
