---
id: task-25
title: 'Tournament mode: 5 games and a final ranking'
status: To Do
assignee: []
created_date: '2026-10-07 10:38'
labels:
  - engine
  - ui
dependencies:
  - task-24
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let a room play a tournament: 5 games in a row, with a ranking of the players after each game and a final ranking after game 5.

Ranking order per player (a team value counts for both players of the team):
1. Games won.
2. Total score. Per game: the winning team gets 13, the losing team gets 13 - lines left, minimum 0 (see task-24).
3. Triple crosses (hands in which the own team crossed 3 lines).
4. Double crosses (hands in which the own team crossed 2 lines).

The per-game numbers come from task-24.

Open questions. Decide them before the build and write the answers in RULE_ASSUMPTIONS.md:
- Do partners rotate between games (each player plays with each other player), or are the teams fixed?
- What happens when players are still equal after all 4 criteria?
- Can bots take part? Do bots get a place in the ranking?
- What happens when a player leaves during the tournament (a bot takes over the seat during a match today)?
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The host can start a tournament of 5 games from the lobby.
- [ ] #2 After each game, all clients show the same ranking: games won, total score, triple crosses, double crosses, in that order. Tests cover the ranking order and ties.
- [ ] #3 After game 5, all clients show the final ranking.
- [ ] #4 A host reload during the tournament keeps the tournament state and the ranking.
- [ ] #5 RULE_ASSUMPTIONS.md describes the tournament: number of games, partner rule, ranking order and ties.
- [ ] #6 All new text is in Dutch and English and works at phone width.
<!-- AC:END -->
