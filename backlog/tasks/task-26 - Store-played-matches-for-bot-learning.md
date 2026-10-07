---
id: task-26
title: Store played matches for bot learning
status: To Do
assignee: []
created_date: '2026-10-07 10:44'
labels:
  - engine
  - firestore
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Store every finished multiplayer match in Firestore, so we can later analyse human play and tune the bots. Background: spike task-13 (backlog/docs/doc-1).

Record per hand (compact, about 200 bytes): dealer, the 4 dealt hands, the turned cards, the bids in order, the cards played in order, and the result (playing team, points, lines crossed, kapot, koei). The dealt hands make the record readable with any engine version; a replay from seed + actions would need the same engine version.

The host collects the hands during the match and writes one document games/{id} at GAME_OVER: about 5 KB, 1 write per match. 200 matches per day is 1% of the free write quota and about 365 MB per year of storage.

Not in scope: solo games (they use no Firestore and work offline; an upload later is a possible follow-up), unfinished matches, bot-only matches (npm run bench can generate those locally).

Open question: does the app need a privacy note for this data? The record has no names and no uids.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The host builds a record per hand with dealer, the 4 dealt hands, the turned cards, the bids in order, the cards played in order and the result. Tests cover the record of a full match.
- [ ] #2 The record survives a host reload: the host keeps it with the engine state in localStorage.
- [ ] #3 At GAME_OVER the host writes one games/{id} document with the hand records, the app version and per seat human or bot. It has no names and no uids. The match adds exactly 1 Firestore write.
- [ ] #4 firestore.rules let a signed-in user create a games document with a size limit, and allow no read, update or delete from the app. A test against the emulator covers the rule.
- [ ] #5 Solo games and unfinished matches write nothing.
- [ ] #6 README.md describes the games collection and how to export it for analysis.
<!-- AC:END -->
