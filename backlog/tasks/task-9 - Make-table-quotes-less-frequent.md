---
id: task-9
title: Make table quotes less frequent
status: To Do
assignee: []
created_date: '2026-10-05 07:14'
updated_date: '2026-10-05 07:59'
labels:
  - quotes
dependencies:
  - task-8
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With more quotes being added, a quote should not fire every time its condition is met. Limit how often quotes appear so table talk stays fun instead of noisy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A quote fires only some of the time when its condition is met
- [ ] #2 Each quote text shows at most once per game, counted over all players together (if one player said it, no other player says it again that game)
- [ ] #3 The 'hurry' quotes (e.g. ''Tis uw beurt he') are exempt from the once-per-game rule and may repeat
- [ ] #4 A seat says at most one quote per minute

- [ ] #5 All clients show the same quote at the same moment, or none
<!-- AC:END -->
