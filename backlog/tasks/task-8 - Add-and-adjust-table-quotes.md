---
id: task-8
title: Add and adjust table quotes
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 07:01'
labels:
  - quotes
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New table-talk sayings from player feedback, plus one condition fix. Quotes live in src/lib/quotes.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 'Dan zullen we dat nog eens proberen' fires when a player wins a trick with a suit and then leads that suit again
- [x] #2 'Hier ben ik helemaal van slag van' and 'Dat is een slag in het gezicht' fire when the player's team loses a trick
- [x] #3 'Wij zijn er nog denk' and ''T is nog van ons, telt maar na' fire when a team reaches 21 points on the last trick
- [x] #4 'Wanneer gaan de kaarten draaien?' (or similar) fires when a team has not crossed off any mark (meetje vegen) yet
- [x] #5 'We zijn er al se' fires at 21 points instead of 20
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add QUOTES groups (again, trickLost, madeIt, noMarks) and detection in activeQuotes; move "there" to 21 points -> check: new tests in tests/quotes.test.ts pass
2. Adjust stale expectations in quotes.test.ts (draw silence now only means no lost/revenge line; 20 points no longer fires "there") -> check: npm test
3. Run npm test and npm run build -> check: both pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/lib/quotes.ts: added QUOTES.again/trickLost/madeIt/noMarks; activeQuotes detects: winner leads the suit they won the last trick with (key n), losing-team grumble per trick (x), a team crossing 21 only on the 6th trick (u), and teams with zero crossed marks at SCORED/GAME_OVER (w); 'there' threshold 20 -> 21. tests/quotes.test.ts: new tests per criterion, updated the draw-silence and 20->21 expectations. npm test 117 pass, npm run build clean. Check by hand: quote frequency in a real solo game.
<!-- SECTION:NOTES:END -->
