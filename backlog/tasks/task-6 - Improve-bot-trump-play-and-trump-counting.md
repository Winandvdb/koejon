---
id: task-6
title: Improve bot trump play and trump counting
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-05 14:17'
labels:
  - bots
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Players reported these bot card-play mistakes:
- Grietje undertrumped (kocht onder) on trick 1 or 2 while she could discard other cards, and she still held the trump ace.
- Klaas undertrumped on the second-to-last trick while his last card was not trump.
- Julia (hard) used her last trump on her partner's ace, which was already winning the trick.
- Bots do not count trump well enough. They often lead their highest card in a suit and an opponent simply trumps it, instead of saving that card until the opponents are out of trump.
- Bots sometimes decline to trump a trick, and then lose that trump later when the opponents pull trump.

If this gets too big for one PR, split it: trump counting (#3-#5) first, then the specific mistakes (#1-#2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bot does not undertrump when it has a non-trump card it can discard
- [ ] #2 A bot does not trump a trick its partner is already winning
- [ ] #3 A bot tracks how many trumps are still out and which players can no longer hold trump
- [ ] #4 A bot does not lead a high non-trump card that an opponent can still trump, unless it has no better lead
- [ ] #5 A bot trumps a trick worth taking when its trump would probably be pulled later anyway
- [ ] #6 Each case above is covered by a test
- [ ] #7 The match simulation still passes and the bot win rate does not get worse
<!-- AC:END -->
