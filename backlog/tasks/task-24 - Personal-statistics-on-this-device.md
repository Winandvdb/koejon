---
id: task-24
title: Personal statistics on this device
status: To Do
assignee: []
created_date: '2026-10-07 10:38'
labels:
  - engine
  - ui
dependencies:
  - task-17
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Keep per-player statistics in localStorage and show them to the player. Design and reasons: backlog/docs/doc-1 (spike task-13). No Firestore.

Statistics per player. A team value counts for both players of the team.
- Games played, games won.
- Total score. Per game: the winning team gets 13. The losing team gets the meetjes it crossed minus its koeien, minimum 0. This equals 13 - lines left, minimum 0.
- Double crosses: hands in which the own team crossed 2 lines (first card at a doubled stake, second card, or first card + kapot).
- Triple crosses: hands in which the own team crossed 3 lines (doubled first card + kapot, or second card + kapot). After task-17 a hand crosses at most 3 lines.
- Bids made: hands in which the player said "ik ga" or chose trump as dealer. Bids won: of those, the hands that the own team won.

These numbers are also the input for the tournament ranking (follow-up task).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The engine keeps per-team double and triple cross counts and per-seat bids made and bids won for the match. They are in the public state, so a guest that reloads mid-match keeps them. Tests cover them.
- [ ] #2 A match score function gives 13 for the winning team and max(0, 13 - lines left) for the losing team. Tests cover a normal loss and a loss with more than 13 lines left.
- [ ] #3 At GAME_OVER each human client adds the numbers of its own seat to localStorage once. A reload on the end screen does not count the match twice. Bot seats never count. It works in solo and offline.
- [ ] #4 The home screen shows the statistics, labelled as statistics on this device, in Dutch and English, at phone width.
- [ ] #5 The app calls navigator.storage.persist() once. Every localStorage access is in try/catch.
- [ ] #6 RULE_ASSUMPTIONS.md describes the match score and the double and triple cross count.
- [ ] #7 The change adds no Firestore reads or writes.
<!-- AC:END -->
