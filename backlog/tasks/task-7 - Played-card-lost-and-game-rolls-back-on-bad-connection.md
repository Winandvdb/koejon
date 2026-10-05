---
id: task-7
title: Played card lost and game rolls back on bad connection
status: In Progress
assignee:
  - '@lab900-winand-vandenbergh'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-05 09:41'
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
- [ ] #1 A card the player saw accepted is never undone
- [ ] #2 If a play fails, the player sees an error and the card returns to the hand before any later card is shown
- [ ] #3 No player sees a later card while an earlier play can still be undone
- [ ] #4 A test reproduces the rollback (e.g. a dropped or late message) and the fix makes it pass
<!-- AC:END -->
