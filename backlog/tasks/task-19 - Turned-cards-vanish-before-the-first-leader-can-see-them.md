---
id: task-19
title: Turned cards vanish before the first leader can see them
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-06 15:18'
updated_date: '2026-10-06 15:18'
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
- [ ] #1 The turned cards stay at the dealer's seat during PLAYING until the first card of the hand is played, also when all 4 seats confirmed
- [ ] #2 The turned cards go away when the first card is played
- [ ] #3 The first leader still needs no extra click
<!-- AC:END -->
