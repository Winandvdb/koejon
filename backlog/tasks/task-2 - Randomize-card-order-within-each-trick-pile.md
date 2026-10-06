---
id: task-2
title: Randomize card order within each trick pile
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-06 08:50'
labels: []
dependencies:
  - task-1
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In real play the four cards inside a collected trick pile (slag) are not always in the order they were played. Add a randomizer so the order of cards within each won trick pile is shuffled before the piles are stacked into the new deck.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The order of the 4 cards in each collected trick pile is randomized
- [x] #2 Randomization uses the seeded RNG so games stay reproducible
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. resolveTrick: shuffle the 4 trick cards with rngShuffle (seeded state RNG) before they go on the pile -> check: piles.test "shuffles the 4 cards" (40 seeds give many orders)
2. Same RNG gives the same order -> check: piles.test reproducibility test
3. Adapt task-1 tests that expected play order; update RULE_ASSUMPTIONS -> check: npm test, npm run build
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stacked on task-1 (PR #35): branch starts from feature/task-1-rebuild-deck-from-tricks.
Engine: resolveTrick in src/engine/engine.ts shuffles the 4 cards with rngShuffle(s, ...) before they go on the team pile. The shuffle happens per trick, not at stack time, because after an all-passed deal the piles hold the thrown-in hands, not tricks.
Tests: tests/piles.test.ts has 2 new tests (shuffle happens, same seed gives same order); the task-1 tests now compare card sets for the shuffled trick. npm test and npm run build pass.
Manual check: none needed (engine only).
<!-- SECTION:NOTES:END -->
