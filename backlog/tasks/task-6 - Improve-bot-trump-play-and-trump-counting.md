---
id: task-6
title: Improve bot trump play and trump counting
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-05 14:46'
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
- [x] #1 A bot does not undertrump when it has a non-trump card it can discard
- [x] #2 A bot does not trump a trick its partner is already winning
- [x] #3 A bot tracks how many trumps are still out and which players can no longer hold trump
- [x] #4 A bot does not lead a high non-trump card that an opponent can still trump, unless it has no better lead
- [x] #5 A bot trumps a trick worth taking when its trump would probably be pulled later anyway
- [x] #6 Each case above is covered by a test
- [x] #7 The match simulation still passes and the bot win rate does not get worse
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a dump helper: never overtake the partner, never undertrump while a plain card exists; use it in all dump paths (AC #1, #2) -> check: new tests for undertrump and partner-winning cases
2. Add trump-holder tracking helpers on HandRead (who may still hold trump, higher trumps out) (AC #3) -> check: tests that read the log and change the lead
3. Lead a plain ace only when no opponent can likely trump it, else a better lead (AC #4) -> check: test with and without known trump voids
4. Take a scoring trick with a trump that higher trumps would pull later (AC #5) -> check: test
5. Run npm test, npm run build and a new-vs-old bot benchmark (AC #6, #7) -> check: all pass, win rate >= 50%
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changed src/bots/bot.ts:
- dump(): every throw-away path (duck, decided hand, lazy skill fallback) never overtakes the partner and never undertrumps while a plain card exists. noUndertrump() also filters the partner-winning vet.
- mayHoldTrump(): a seat can hold trump unless it showed out of trump or no trump is left outside the hand. HandRead.suitSeen counts cards per suit for hard bots.
- Plain aces are led only when no opponent can trump them (known void, or the suit runs short outside the hand: SHORT_SUIT=3).
- A trick with points is taken with a trump that is doomed (no boss trump, outnumbered by trumps outside).
Tests: 6 new cases in tests/bot.test.ts; one old duck test now holds the boss HA so its trump is not doomed.
Benchmark (new vs old bot, 2000 matches per level, seats swapped): easy 56.0%, normal 56.4%, hard 53.9% wins for the new bot.
<!-- SECTION:NOTES:END -->
