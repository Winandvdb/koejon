---
id: task-22
title: Guest seat turns into a bot after the host minimizes the app
status: To Do
assignee: []
created_date: '2026-10-06 18:27'
updated_date: '2026-10-06 19:23'
labels:
  - bug
  - network
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen once in a multiplayer game. We could not reproduce it again.
1. The host minimized the app (phone). The guest lost the connection to the host. The guest's app went back to the start screen. The guest did NOT press the leave button.
2. Later the host opened the app again and refreshed. After that, a bot played for the guest. The guest still saw the table, but only the backs of her own cards.
3. When the guest rejoined the room again, she got her seat back and could play.

Expected: a host that goes to the background never causes a guest's seat to go to a bot. A guest who sees the table always sees her own cards and can play.

What the code tells us (cause not found):
- She could reclaim the seat by rejoining. So the seat held a bot with her own uid. Only a mid-game `leave` intent makes that (src/lib/host.ts, around line 349). `kickSeat` uses a new bot uid, and then a rejoin cannot reclaim the seat.
- Only the leave button (`onLeave` in src/App.svelte) sends `leave`, and it was not pressed. So the bot seat came from somewhere else. Candidates to check:
  - The reloaded host reads `seats` from the Firestore room doc (`load()` in host.ts). The P2P host writes the room doc only when the seats, options or lobby state change (`syncFirestore` in src/lib/link-p2p.ts), and a failed write while minimized is not retried until the next publish. A stale room doc can bring back old seats.
  - An intent doc that a minimized host did not handle in time, handled after the refresh.
- The start screen: only `onLeave` and the "room vanished" effect (src/App.svelte, around line 140) go there. The effect runs when `view.room` goes null after a room was shown. A Firestore fallback listener that gives no room for a moment on a bad connection can trigger it.
- The card backs: the host publishes hands only for human seats (host.ts, around line 429). Her session still found her uid in the seat (`seatOf`), so it showed the table without a hand. Only `joinRoom` reclaims a bot seat (src/lib/room.ts, around line 160), so only a manual rejoin fixed it.

Related: task-7 (rollback on bad connection).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the guest's own seat is held by a bot with her uid while she is at the table, her session reclaims the seat by itself (sends join), with a test
- [ ] #2 A short null room from a dropped listener does not send the guest to the start screen while the room still exists, with a test
- [ ] #3 Check the two candidate causes (stale room doc seats after a host reload, late intent doc). Write what was found in the task notes. If a cause is confirmed, a test reproduces it and the fix makes it pass
- [ ] #4 A console warning logs when a seat with a human uid turns into a bot, with the reason (leave intent or kick), so a next case can be traced
<!-- AC:END -->
