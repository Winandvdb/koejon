---
id: task-11
title: Card sort options and manual sort
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 06:47'
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
- [x] #1 The player can sort low to high inside a suit
- [ ] #2 The player can drag cards into their own order
- [ ] #3 On the first deal the game asks how to sort; the choice is saved in localStorage and can be changed later in settings
- [x] #4 A manual order is kept as cards leave the hand
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. prefs.ts: replace the sortHand boolean with sortMode (high | low | manual | null = not chosen yet), saved under a new localStorage key; add pure helpers arrangeHand() and moveCard() -> check: unit tests in tests/prefs.test.ts (AC #1, #4)
2. Table.svelte: show the hand with arrangeHand(); in manual mode keep a per-hand order of card keys and reorder it with pointer drag (works on touch), tap still plays -> check: build + manual check on phone (AC #2, #4)
3. Table.svelte: when sortMode is null and a hand is shown, ask how to sort (3 buttons) -> check: build + manual check (AC #3)
4. App.svelte settings: replace the checkbox with a 3-way segmented control -> check: build + manual check (AC #3)
5. i18n: new strings in nl and en -> check: svelte-check types
6. npm test + npm run build pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changed: src/lib/prefs.ts (sortHand boolean -> sortMode high|low|manual|null under new key koejon-sort-mode; pure arrangeHand/moveCard), src/components/Table.svelte (hand order from arrangeHand, pointer drag reorder in manual mode, first-deal sort question), src/App.svelte (settings: 3-way segmented control), src/lib/i18n.ts (nl+en strings), src/app.css (drag + question styles). Tests: tests/prefs.test.ts covers high, low, manual order and cards leaving the hand.
Manual check: drag on phone and desktop; tap still plays; question shows once on first deal and does not cover action buttons; settings popup fits at phone width.
Limits: manual order is per hand and in memory only (a reload shows deal order); switching to manual mid-hand starts from deal order.
<!-- SECTION:NOTES:END -->
