---
id: task-1
title: Rebuild deck from stacked trick piles instead of reshuffling
status: To Do
assignee: []
created_date: '2026-09-30 19:43'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In real Koejonnen the deck is not reshuffled between hands. The new deck is formed by stacking the two teams' piles of won tricks (slagen) on top of each other. Replace the fresh rngShuffle(fullDeck()) on each deal with a deck built from the collected trick piles.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The deck for a new hand is built by stacking both teams' trick piles
- [ ] #2 No full random shuffle is applied when rebuilding the deck
- [ ] #3 Existing tests and bot simulation still pass
<!-- AC:END -->
