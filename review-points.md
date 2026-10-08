---
base: acb4250395fba31712847dffc38e815ccd3c7cf9
audited-base: acb4250395fba31712847dffc38e815ccd3c7cf9
audited-head: be3a312e3cf98b340fda45402fe94366c5f10d2f
implementation: be3a312e3cf98b340fda45402fe94366c5f10d2f
head: be3a312e3cf98b340fda45402fe94366c5f10d2f
reviewers: /code-review high
harness: claude-code
session: 0e3b4d47-67f2-4d87-8524-dd118006ad9c
fixed-in: HEAD
anchors: review-commit
---

## Fixed

### Discarded bot moves drew from the seeded stream
- file: src/lib/host.ts:485
- file: tests/solo.test.ts:158-160
- source: /code-review high
- severity: medium
- observation: drainBotAcks() asked a bot for a move on every commit and threw away anything but an ack, yet each ask drew from the seeded rand. An extra commit (a display toggle) changed every later bot play.
- fix: ask the bot only when its legal actions hold an ack or troefke; a test toggles an option mid-game.

### A resumed solo game got a fresh seeded stream
- file: src/App.svelte:180
- file: src/App.svelte:235
- source: /code-review high
- severity: medium
- observation: ensureHost() seeded every solo host, also one that resumed a saved game from storage, so ?seed= restarted the stream in the middle of an old game.
- fix: only onSolo() hands a seeded source to the next attach; a resume gets none.

### The seed stayed for every later solo game in the tab
- file: src/App.svelte:236
- source: /code-review high
- severity: low
- observation: seed was a constant for the page's life; after Leave and a new solo game the same deal came back with no seed in the URL.
- fix: the seed is used once and then cleared.

### Third copy of mulberry32
- file: src/lib/seed.ts:31
- source: /code-review high
- severity: low
- observation: seededRandom() repeated the engine's rngNext; a fix in one copy would not reach the other.
- fix: wrap rngNext from the engine.

## Ignored

### Seed the quote rolls and bot delays too
- file: src/lib/host.ts:101
- source: /code-review high
- severity: low
- observation: quoteRand and botDelay still use Math.random, so table talk differs between two seeded runs.
- why: quotes depend on Date.now(); sharing the stream would make the game depend on timing.

### Pass SEED_ALLOWED into demoSeed instead of an outer check
- file: src/App.svelte:39
- source: /code-review high
- severity: info
- observation: the allowed check runs outside and a constant true goes into demoSeed's own allowed parameter.
- why: the outer check lets Vite drop the parse code from live bundles (bundle checked).

### Guard import.meta.env in seed.ts
- file: src/lib/seed.ts:13
- source: /code-review high
- severity: info
- observation: seed.ts reads import.meta.env directly; outside Vite it would throw on load.
- why: only App.svelte imports it; Vite's static replacement removes the code in live builds.

### The unseeded-games-differ test depends on chance
- file: tests/solo.test.ts:163-166
- source: /code-review high
- severity: info
- observation: two Math.random games could match by chance, and the test pins no code behaviour.
- why: a match needs equal 31-bit seeds and names; it pins acceptance criterion 2.

## Assumptions

### Seed only solo games, never a multiplayer room
- file: src/lib/seed.ts:25
- alternative: seed Math.random globally, as the spike prototype did
- confidence: 0.85
- why: the issue left this open; a seeded host would know every hand, and a global override also seeds Firebase and WebRTC ids. A demo of multiplayer would want it, which keeps this below 0.9.

### No seed on the dev channel either, only dev server and VITE_ALLOW_SEED builds
- file: src/lib/seed.ts:13
- alternative: also allow it when VITE_APP_VARIANT=dev (dev channel, PR previews)
- confidence: 0.7
- why: the human asked that players cannot abuse it in prod; the dev channel is public too, so I kept it out. A reviewer who wants to try a seed on a PR preview would need the other reading.

### Seed only the first new solo game of a page load
- file: src/App.svelte:235-236
- alternative: seed every solo game until the page reloads
- confidence: 0.75
- why: a demo films one game per load, and a seed nobody sees in the URL should not silently fix later games.
