---
id: task-18
title: Codebase cleanup from the code review
status: To Do
assignee: []
created_date: '2026-10-06 09:19'
updated_date: '2026-10-06 09:26'
labels:
  - cleanup
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixes and cleanup from the codebase review of 2026-10-06, after verification against develop. Only the storage guard and the troefke chance change behaviour; everything else is hygiene with no visible change.

Verified findings:
- App.svelte (onMount, attach) and Home.svelte (component init) read and write localStorage without try/catch. When storage access throws (cookies disabled, some private modes) the app fails at startup. theme.ts calls matchMedia outside its try.
- tsconfig.app.json includes only src/**, so tests/ and scripts/ are never type-checked. Example: tests/rollback.test.ts uses rank '7', which is not a valid Rank.
- RULE_ASSUMPTIONS.md describes an older architecture: engine state in rooms/{code}/engine/state (now localStorage koejon-engine-{code}), heartbeat 5 s / stale 15 s (now HEARTBEAT_MS 15 s / stale 45 s), batched writes with hands/host and an engine snapshot (neither exists).
- quotes.ts: the hash comment says all clients pick the same line; only the host's QuoteBook picks.
- Unused exports: cardName and cardEq (cards.ts), handMasked (engine.ts), the rngNext export (rng.ts).
- Unused CSS in app.css: .btn.ghost, .btnrow, .bid-row, .hint, .seat-list li.clickable.
- Duplicates: tests/helpers.ts re-implements mulberry32; memoryStore() and until() are copied in solo, rollback and e2e tests; teamOf (seat % 2) is defined in engine.ts, bot.ts and quotes.ts and inlined in Lobby, Table and InfoPanel; Boomke.svelte hardcodes 13 instead of START_LINES.
- firestore.indexes.json has ~47 lines of boilerplate comments for an empty config.
- room.ts actionKey keeps only top-level keys plus s and r: a future nested field would drop out of the key.
- The simulation test only runs normal bots.
- Home.svelte room code input allows 6 characters; codes have 5.
- bot.ts botAction, case 'troefke' (lone legal action of the bidder after it confirmed): it always returns troefke, and its comment presents it as the normal path. It never runs, because the host and the simulation only ask seats in pendingSeats for a move, and then the partner is pending, not the bidder. It cannot simply be deleted: the switch must cover every Action type. The real troefke decision is in the 'ack' branch.
- The troefke chance is about TROEFKE_CHANCE squared instead of TROEFKE_CHANCE (found by reading host.ts, not yet proven by a test): drainBotAcks asks the bidder bot for a move and applies it only when it is 'ack'. When the bot picks troefke, drainBotAcks drops it, and scheduleBots later asks the bot again, so wantsTroefke() rolls a second time.

Also check, and change only if equal: Table.svelte pendingAcks re-implements the PLAYING branch of pendingSeats.

Checked and NOT a problem (do not change): the e2e assertion handRef(code, 'host') is a guard that the old hands/host doc is no longer written. Intent docs are deleted after processing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app starts and solo play works when every localStorage call throws; a test covers this
- [ ] #2 theme.ts can be imported without window.matchMedia
- [ ] #3 npm run build type-checks tests/ and scripts/; all type errors there are fixed
- [ ] #4 RULE_ASSUMPTIONS.md and the quotes.ts hash comment match the current code
- [ ] #5 The listed unused exports and unused CSS rules are removed
- [ ] #6 The listed duplicates use one shared helper or constant each
- [ ] #7 firestore.indexes.json contains only the config
- [ ] #8 actionKey gives the same key for equal actions and different keys for different actions, also with nested fields; a test covers this
- [ ] #9 The simulation test also runs easy and hard bots
- [ ] #10 The room code input allows exactly the room code length
- [ ] #11 No other behaviour changes; npm test and npm run build pass

- [ ] #12 The unreachable troefke branch in botAction fails loudly (an error that names the broken assumption) instead of always asking troefke, and its comment points to the 'ack' branch as the real decision
- [ ] #13 A bidder bot decides troefke once per hand, so it asks with chance TROEFKE_CHANCE on a strong hand; a test drives the host flow and proves it
<!-- AC:END -->
