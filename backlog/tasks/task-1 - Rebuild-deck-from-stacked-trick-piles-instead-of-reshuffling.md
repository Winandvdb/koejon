---
id: task-1
title: Rebuild deck from stacked trick piles instead of reshuffling
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-06 08:43'
labels: []
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In real Koejonnen the deck is not reshuffled between hands. The new deck is formed by stacking the two teams' piles of won tricks (slagen) on top of each other. Replace the fresh rngShuffle(fullDeck()) on each deal with a deck built from the collected trick piles.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The deck for a new hand is built by stacking both teams' trick piles
- [x] #2 No full random shuffle is applied when rebuilding the deck
- [x] #3 Existing tests and bot simulation still pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add State.piles; resolveTrick puts each won trick on the winner team pile -> check: piles.test "won trick" test
2. nextDeck(): stack team 0 pile on team 1 pile, one seeded cut (4..20), no shuffle; fresh shuffle only for the first deal -> check: piles.test deck test reads the dealt deck back and finds one cut
3. All-passed deal: hands thrown in unshuffled -> check: piles.test all-passed test
4. Keep piles private; guard old saved states -> check: privacy test in piles.test
5. Rules text + RULE_ASSUMPTIONS; deal invariant in simulation -> check: npm test, npm run build
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Engine: State.piles (types.ts) holds the cards of the tricks each team won, in play order. resolveTrick adds to it. nextDeck() in engine.ts stacks team 0 on team 1 and cuts once at a seeded random point (lift 4..20 cards, task 3 makes this cut interactive). The first deal of a match still shuffles. After all-passed, the hands go back on the deck as they are. apply() sets piles to [[],[]] for engine states saved before this change. piles is not in toPublic. Rules NL/EN and RULE_ASSUMPTIONS updated.
Tests: tests/piles.test.ts (new), deal invariant (24 unique cards) in tests/simulation.test.ts. npm test and npm run build pass.
Manual check: none needed (engine only).
<!-- SECTION:NOTES:END -->
