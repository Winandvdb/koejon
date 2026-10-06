---
id: task-16
title: Different name and icon for the dev version
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-06 07:25'
updated_date: '2026-10-06 07:29'
labels:
  - pwa
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a player installs both the live app (koejon-3059e.web.app) and the dev channel app, both show up as "Koejonnen" with the same icon. There is no way to tell them apart on the home screen or in the app itself.

Make the dev build distinguishable: a different app name and icon in the manifest and install icons, and a visible dev marker in the app UI. The dev channel deploy (.github/workflows/firebase-hosting-develop.yml) already sets the job-wide env VITE_SHOW_USAGE=true, which App.svelte reads to show the Firestore usage counter. The build can key off that same flag (or a new dedicated VITE_ flag set in the dev workflow). The manifest and icons are static files in public/, so a Vite plugin (like the serviceWorker() plugin in vite.config.ts) can emit a dev manifest and dev icons at build time. Live builds must stay identical to today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A dev build (VITE_SHOW_USAGE=true or a dedicated flag) produces a manifest with a different name/short_name (e.g. "Koejon DEV") than the live build
- [x] #2 A dev build produces visibly different install icons (icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png) so the installed dev app stands out on the home screen
- [x] #3 The app UI shows a clear dev marker (e.g. the title or a badge) on a dev build, so the difference is also visible while playing
- [x] #4 A normal build without the flag is unchanged: manifest name "Koejonnen", original icons, no dev marker
- [ ] #5 Installed dev app and installed live app can be told apart on a phone home screen (manual check)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add pwa/devbrand.ts (devManifest + devIndexHtml pure functions) and pwa/dev/ icon assets (icon-dev.svg + PNGs via rsvg-convert) -> check: unit tests in tests/pwa.test.ts pass, dev manifest refs files that exist (AC1, AC2)
2. Add devBranding plugin to vite.config.ts, gated on VITE_SHOW_USAGE=true (already set job-wide in the develop workflow), placed before serviceWorker so emitted files land in the precache list; add manifest-dev.webmanifest to the no-cache header in firebase.json -> check: VITE_SHOW_USAGE=true vite build produces manifest-dev.webmanifest + dev icons in dist and transformed index.html; plain build unchanged (AC1, AC2, AC4)
3. Add a DEV chip next to the brand in src/App.svelte (shown when the existing DEV flag is on) + .dev style in app.css -> check: svelte-check passes, chip visible (AC3)
4. Update AGENTS.md pwa/ row for the new module -> check: file updated (repo rule)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dev builds (VITE_SHOW_USAGE=true, already set job-wide in the develop deploy workflow) emit pwa/dev/ icons + manifest-dev.webmanifest and rewrite index.html (manifest link, icons, title, theme color, apple-mobile-web-app-title) via a new devBranding plugin in vite.config.ts; pure logic lives in pwa/devbrand.ts. A "DEV" chip shows in the top bar on dev builds (same flag as the usage counter). manifest-dev.webmanifest added to the no-cache header in firebase.json. Verified: VITE_SHOW_USAGE=true vite build produces dist/manifest-dev.webmanifest (name "Koejonnen DEV", amber theme, dev icons) and transformed index.html; dev files are in the sw precache list; a plain build is unchanged. Manual check: install both the dev channel app and the live app on a phone and confirm different icon + name on the home screen.
<!-- SECTION:NOTES:END -->
