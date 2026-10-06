---
id: task-15
title: Apply Lighthouse findings from the prod audit
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 12:04'
updated_date: '2026-10-06 08:22'
labels:
  - performance
  - seo
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Lighthouse run on https://koejon.web.app (incognito, mobile, Slow 4G, 2026-10-05) gave Performance 91, Accessibility 100, Best Practices 100, SEO 82. FCP 1.6 s, LCP 3.4 s, total payload 286 KB.

Findings and their cause:

1. Longest request chain (1,637 ms): auth/iframe.js (93 KB, firebaseapp.com) -> getProjectConfig, plus apis.google.com/js/api.js and gapi (41 KB). getAuth(app) in src/lib/firebase.ts installs the popup/redirect resolver, but the app only uses anonymous sign-in. Fix: use initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }) without a popupRedirectResolver. Check that tests and e2e (Node) still work with it.
2. LCP 3.4 s on the home h1: App.svelte waits for signIn() before it shows the home screen. Fix 1 makes sign-in faster.
3. SEO: index.html has no meta description. Add one in Dutch.
4. SEO: robots.txt is invalid, because the ** rewrite in firebase.json returns index.html. Add public/robots.txt.
5. Best practices (unscored): no COOP header and no frame control. Add X-Frame-Options: DENY, Content-Security-Policy: frame-ancestors 'none' and Cross-Origin-Opener-Policy: same-origin in firebase.json hosting headers. A full CSP is out of scope (Firestore, WebRTC and emulator need a careful allow-list).
6. Optional: unused JS 108 KB of 146 KB in one bundle. Lazy-load marked (RulesDialog) and qrcode (Lobby) with dynamic import().

Out of scope: source maps in prod, full CSP / Trusted Types, the non-composited colour transition on buttons.

Note: task-14 (PWA) also adds public/ and changes index.html and the sign-in startup. Expect a small merge conflict.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The app makes no request to firebaseapp.com/__/auth/iframe or apis.google.com on load
- [ ] #2 Anonymous sign-in keeps the same uid after a reload
- [x] #3 index.html has a meta description
- [x] #4 /robots.txt is served as a valid robots.txt, not as HTML
- [x] #5 Hosting responses include X-Frame-Options, CSP frame-ancestors and Cross-Origin-Opener-Policy headers
- [ ] #6 Lighthouse (incognito, mobile) on the dev channel gives SEO 100 and LCP below 3.4 s
- [x] #7 npm test, npm run build and npm run e2e pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. firebase.ts: initializeAuth with indexedDB + local persistence, no popupRedirectResolver (AC1, AC2) -> check: build output has no apis.google.com / auth/iframe strings; npm test and e2e pass; manual reload keeps uid
2. index.html: Dutch meta description (AC3) -> check: unit test reads index.html
3. public/robots.txt (AC4) -> check: unit test; file lands in dist/
4. firebase.json hosting headers X-Frame-Options, CSP frame-ancestors, COOP (AC5) -> check: unit test reads firebase.json
5. Lazy-load marked (RulesDialog) and qrcode (Lobby) with import() -> check: build shows separate chunks
6. AC6 Lighthouse on dev channel -> manual check after merge
7. npm test, npm run build, npm run e2e (AC7)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changes:
- src/lib/firebase.ts: initializeAuth with [indexedDBLocalPersistence, browserLocalPersistence], no popupRedirectResolver. The built bundle no longer has apis.google.com/js/api.js, __/auth/iframe or gapi code.
- index.html: Dutch meta description.
- public/robots.txt (also precached by the service worker).
- firebase.json: X-Frame-Options DENY, CSP frame-ancestors none, COOP same-origin on all hosting responses.
- RulesDialog.svelte and Lobby.svelte: dynamic import() for marked and qrcode (own chunks md-*.js 44 KB and browser-*.js 23 KB).
- tests/hosting.test.ts: meta description, robots.txt, headers.

Tests: npm test pass, npm run build pass, npm run e2e pass (local emulators).

Check by hand: AC2 (reload keeps the same uid in the browser) and AC6 (Lighthouse on the dev channel: SEO 100, LCP < 3.4 s, no requests to firebaseapp.com/__/auth/iframe or apis.google.com).
<!-- SECTION:NOTES:END -->
