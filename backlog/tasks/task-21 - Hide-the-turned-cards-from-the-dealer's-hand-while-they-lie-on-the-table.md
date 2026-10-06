---
id: task-21
title: Hide the turned cards from the dealer's hand while they lie on the table
status: To Do
assignee: []
created_date: '2026-10-06 18:19'
labels:
  - ui
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 2 turned cards are part of the dealer's hand. While they lie face up at the dealer's seat (`turnedVisible(pub)` in src/engine/view.ts), the dealer's own hand in Table.svelte also shows them. The dealer sees the same cards twice, which breaks immersion. Other players already see 2 card backs less for the dealer (`handCounts - 2`). Do the same for the dealer's own hand: leave the turned cards out of the shown hand until the dealer pressed "Gezien" and the cards left the table. Then add them to the hand.

Note: since task-19, the turned cards stay on the table until the first card of the hand is played. The dealer never leads the first trick, so this is safe. Only the UI changes: the engine and the legal actions stay the same.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While the turned cards show at the dealer's seat, the dealer's own hand does not show those 2 cards
- [ ] #2 When the turned cards leave the table, they appear in the dealer's hand
- [ ] #3 A second turned card that is still face down is also left out of the dealer's hand
- [ ] #4 Hands of the other seats do not change
- [ ] #5 The rule for when the cards are hidden is a pure function with a unit test that fails before the change
<!-- AC:END -->
