---
id: task-7
title: Played card lost and game rolls back on bad connection
status: Done
assignee:
  - '@lab900-winand-vandenbergh'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-05 09:48'
labels:
  - bug
  - network
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a weak connection a player's played card was not registered. The next player then played a card, which the first player saw. After that the game rolled back and the first player could play a different card, now knowing what the next player holds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A card the player saw accepted is never undone
- [x] #2 If a play fails, the player sees an error and the card returns to the hand before any later card is shown
- [x] #3 No player sees a later card while an earlier play can still be undone
- [x] #4 A test reproduces the rollback (e.g. a dropped or late message) and the fix makes it pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a game sequence number `seq` to the room. The host increments it on every commit (also when the Firestore write fails) and keeps it in storage across a reload -> check: host test (seq goes up after a failed publish and after reload).
2. P2PGuestLink: ignore a Firestore room or hand that is older than the newest state shown (AC #1, #3) -> check: test with fake channel + fake Firestore: channel shows seq 5, closes, a late Firestore copy with seq 3 arrives, view stays at seq 5 (AC #4).
3. RoomSession.act: wait for a newer seq; reject with act-lost when none comes in time. App shows an error; the card never left the hand (AC #2) -> check: unit test with a fake GuestLink and fake timers.
4. i18n text actLost (nl + en) -> check: npm run build.
5. npm test and npm run build pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cause: a P2P guest took Firestore room/hand again when its data channel closed. The P2P host skips most Firestore writes, so that copy could be old: the table went back and the player saw the next card with the old hand.

Changes:
- net-types.ts, transport.ts: new room field `seq` (game state counter, same on every path).
- host.ts: seq goes up on every commit (also when the Firestore write fails) and is kept in storage (`koejon-seq-<code>`), so a reloaded host stays above what guests saw.
- link-p2p.ts (P2PGuestLink): ignore a Firestore room/hand older than the newest state shown; a held hand is shown when its room catches up.
- room.ts: act() resolves on a newer seq, else rejects with act-lost after ACT_ACK_MS (8 s). App.svelte shows $t.actLost (nl + en in i18n.ts). Cards are never shown played before the host accepts them, so the card stays in the hand.

Tests: tests/rollback.test.ts (fake RTC channel + fake Firestore: late seq-3 copy after seq 5 is ignored; seq after failed publish and reload; act resolve / act-lost). npm test and npm run build pass.

Check by hand: 2 browsers, guest on P2P, throttle or cut the guest network mid-trick, then restore. The guest table must never go back. A lost play shows the error after about 8 s.
<!-- SECTION:NOTES:END -->
