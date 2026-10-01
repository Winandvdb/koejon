---
id: task-4
title: Fine-tune bot bidding and card-play decisions
status: To Do
assignee: []
created_date: '2026-09-30 19:43'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The bots need further improvements: they often say 'ik ga' (bid) with bad cards, and their card choices during play need fine tuning. Tighten the heuristics in src/bots/bot.ts for both the bidding decision and card selection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bots bid 'gaan' less often on weak hands
- [ ] #2 Bot card-play choices are improved (e.g. when to trump, when to save points)
- [ ] #3 Bot win-rate / match simulation results improve measurably
<!-- AC:END -->
