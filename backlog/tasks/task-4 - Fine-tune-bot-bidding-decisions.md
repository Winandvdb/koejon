---
id: task-4
title: Fine-tune bot bidding decisions
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-05 15:11'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bots almost always bid ('ik ga') on the first turned card. They do not consider that a second turned card could suit their hand better, so the second card is rarely turned. They also bid with no trump or a single trump, which real players almost never do. Tighten the bidding heuristics in src/bots/bot.ts. Card-play improvements live in a separate task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bots bid 'gaan' less often on weak hands
- [ ] #2 Bots pass more often, so the second card gets turned more often
- [ ] #3 Bots never bid with 0 trump in hand

- [ ] #4 Bots bid with exactly 1 trump only very rarely, and only with a really strong hand
- [ ] #5 Bot win rate in the match simulation does not get worse
<!-- AC:END -->
