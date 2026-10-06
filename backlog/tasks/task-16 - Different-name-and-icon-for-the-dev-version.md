---
id: task-16
title: Different name and icon for the dev version
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-06 07:25'
updated_date: '2026-10-06 07:26'
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
- [ ] #1 A dev build (VITE_SHOW_USAGE=true or a dedicated flag) produces a manifest with a different name/short_name (e.g. "Koejon DEV") than the live build
- [ ] #2 A dev build produces visibly different install icons (icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png) so the installed dev app stands out on the home screen
- [ ] #3 The app UI shows a clear dev marker (e.g. the title or a badge) on a dev build, so the difference is also visible while playing
- [ ] #4 A normal build without the flag is unchanged: manifest name "Koejonnen", original icons, no dev marker
- [ ] #5 Installed dev app and installed live app can be told apart on a phone home screen (manual check)
<!-- AC:END -->
