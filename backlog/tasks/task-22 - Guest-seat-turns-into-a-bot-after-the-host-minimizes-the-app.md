---
id: task-22
title: Guest seat turns into a bot after the host minimizes the app
status: To Do
assignee: []
created_date: '2026-10-06 18:27'
updated_date: '2026-10-06 18:36'
labels:
  - bug
  - network
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen in a multiplayer game:
1. The host minimized the app (phone). The guest lost the connection to the host. The guest's app went back to the start screen.
2. Later the host opened the app again and refreshed. After that, a bot played for the guest. The guest still saw the table, but only the backs of her own cards.
3. When the guest rejoined the room again, she got her seat back and could play.

Expected: a host that goes to the background never causes a guest's seat to go to a bot. A guest who sees the table always sees her own cards and can play. A guest whose seat a bot holds gets it back without a manual rejoin.

Most likely sequence (from the code, not confirmed):
- A minimized host tab stops: no heartbeat, the WebRTC channel drops, and the host does not handle intents. The guest sees "host left".
- The guest goes to the start screen. In src/App.svelte only the leave button (`onLeave`, sends a `leave` intent) and the "room vanished" effect (around line 140) do that. Only `onLeave` sends an intent.
- The `leave` intent waits in Firestore because the host is asleep. The guest rejoins. Her seat is still human, so `joinRoom` does a plain rejoin and sends no `join` intent (src/lib/room.ts, around line 160).
- The host refreshes and reads the old `leave` intent. Mid-game leave puts a bot in the seat and keeps her uid (src/lib/host.ts, around line 349).
- The host publishes hands only for human seats (host.ts, around line 429). Her session still finds her uid in the seat, so it shows the table without a hand.
- A second rejoin sends `join`, which reclaims the bot seat with the same uid. That fits: a host kick (`kickSeat`) uses a new bot uid, so she could not have reclaimed it.

Related: task-7 (rollback on bad connection).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test reproduces the bug (a leave intent that the host reads after the guest rejoined) and fails before the fix
- [ ] #2 A leave intent that is older than the guest's rejoin does not give the seat to a bot
- [ ] #3 When the guest's own seat is held by a bot while she is at the table, she gets the seat back without a manual rejoin, or the UI clearly offers to take it back
- [ ] #4 When the host is in the background, the guest sees that the host is away and is not pushed to the start screen while the room still exists
- [ ] #5 The cause is written in the task notes
<!-- AC:END -->
