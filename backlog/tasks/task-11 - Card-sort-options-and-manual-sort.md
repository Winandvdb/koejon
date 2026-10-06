---
id: task-11
title: Card sort options and manual sort
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 06:44'
labels:
  - ui
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the only option is sort by suit, high to low (src/lib/prefs.ts, Table.svelte). Players want to sort low to high, or arrange their cards themselves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The player can sort low to high inside a suit
- [ ] #2 The player can drag cards into their own order
- [ ] #3 On the first deal the game asks how to sort; the choice is saved in localStorage and can be changed later in settings
- [ ] #4 A manual order is kept as cards leave the hand
<!-- AC:END -->
