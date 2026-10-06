---
id: task-22
title: Guest seat turns into a bot after a lost connection and a host refresh
status: To Do
assignee: []
created_date: '2026-10-06 18:27'
labels:
  - bug
  - network
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen in a multiplayer game:
1. The guest lost the connection. The guest's app went back to the start screen.
2. Later the host refreshed. After that, a bot played for the guest. The guest still saw the table, but only the backs of her own cards.
3. When the guest rejoined the room again, she got her seat back and could play.

Expected: a lost connection never gives the seat to a bot. A guest who sees the table always sees her own cards and can play. A guest whose seat is held by a bot gets it back without a manual rejoin.

Possible causes (not confirmed, check them first):
- The return to the start screen: the effect in src/App.svelte (around line 140) tears down the session when `view.room` goes null after a room was shown. A dropped listener on a bad connection can look like "the room was deleted".
- The bot: a mid-game `leave` intent makes the host put a bot in the seat and keep the uid (src/lib/host.ts, around line 349). If the guest left (or the app sent leave) while offline, Firestore can queue the intent write and send it later. The host can then apply it after its refresh, when the guest is already back at the table. The host "drop stuck seat" path (around line 289) is a second candidate.
- The card backs: the host publishes hands only for human seats (host.ts, around line 429). The guest's session still finds her uid in the seat (`seatOf`), so it shows the table, but gets no hand. Only `joinRoom` reclaims a bot seat (src/lib/room.ts, around line 160), so only a manual rejoin fixed it.

Related: task-7 (rollback on bad connection).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test reproduces the bug (for example a late leave intent that arrives after the guest came back) and fails before the fix
- [ ] #2 A short loss of connection does not send the guest back to the start screen while the room still exists
- [ ] #3 A leave intent that is older than the guest's return does not give the seat to a bot
- [ ] #4 When the guest's own seat is held by a bot while she is at the table, she gets the seat back without a manual rejoin, or the UI clearly offers to take it back
- [ ] #5 The cause is written in the task notes
<!-- AC:END -->
