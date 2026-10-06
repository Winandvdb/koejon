---
id: task-19
title: Turned cards vanish before the first leader can see them
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-10-06 15:18'
updated_date: '2026-10-06 15:53'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When all 3 non-dealers pass and the second turned card has the same suit as the first, a bot dealer chooses after only 2 s. The bots confirm the dealer's cards at once and the first leader is auto-confirmed, so all 4 acks are in at once and the turned cards leave the table. A human first leader gets no "Gezien" button and cannot see the second card. Fix: keep the turned cards on the table until the first card of the hand is played.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The turned cards stay at the dealer's seat during PLAYING until the first card of the hand is played, also when all 4 seats confirmed
- [x] #2 The turned cards go away when the first card is played
- [x] #3 The first leader still needs no extra click
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write tests/turned.test.ts: all pass, dealer chooses, 4 acks, cards still up; gone after first card -> check: test fails first
2. Add turnedVisible() in src/engine/view.ts, use it in Table.svelte -> check: test passes
3. Update RULE_ASSUMPTIONS.md -> check: npm test + npm run build pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cause: the first leader is auto-confirmed and bots confirm at once, so the 4 acks came in at once and the turned cards left the table before a human leader could see them.
Fix: new turnedVisible(pub) in src/engine/view.ts keeps the cards up in PLAYING until the first card falls. Table.svelte uses it. RULE_ASSUMPTIONS.md updated.
Test: tests/turned.test.ts (failed before the fix). npm test and npm run build pass.
Check by hand: solo game, sit left of a bot dealer, see the turned cards stay until you lead.
<!-- SECTION:NOTES:END -->
