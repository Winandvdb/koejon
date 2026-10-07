---
id: task-23
title: Let players close the boomke after a hand is scored
status: To Do
assignee: []
created_date: '2026-10-07 06:27'
labels:
  - ui
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a hand ends (phase SCORED, and GAME_OVER at the end of the match), the boomke opens by itself (`scoring` in src/components/Boomke.svelte). On small screens it moves from the bottom-right corner to the middle of the table (`.boomke-wrap.scored` in src/app.css), and it covers the last trick. Players can no longer see what was played. During the game the boomke is a chip in the bottom-right corner that the player opens and closes. After scoring the chip is hidden, so the player cannot close the boomke.

Keep the automatic open after scoring, but let the player close it. A closed boomke goes back to the chip in the bottom-right corner, the same as during the game. The player can open it again with the chip. The next hand starts with the normal collapsed state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The boomke still opens by itself when a hand is scored and when the match ends
- [ ] #2 In SCORED and GAME_OVER the player can close the boomke; it then shows as the chip in the bottom-right corner
- [ ] #3 With the boomke closed, the last trick on the table is visible
- [ ] #4 The chip opens the boomke again
- [ ] #5 Closing is per player and local only: it does not change the boomke for other players
- [ ] #6 New UI text (if any) is in nl and en
- [ ] #7 Works at phone width
<!-- AC:END -->
