---
id: task-17
title: Cap the first-card stake multiplier at x2
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-06 09:19'
updated_date: '2026-10-07 10:45'
labels:
  - engine
  - rules
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision (2026-10-06): the stake on the first turned card is at most x2. Commit 4355f6a already changed an all-passed deal to set the multiplier to 2 instead of doubling it, but a 20-20 draw still doubles it (x2 -> x4), and a later all-pass drops it back to x2. The rules texts still say that consecutive passed deals keep doubling (x2, x4, ...).

Make the engine, the rules texts and the UI agree on the x2 cap. The test 'consecutive all-passes do not exceed x2' in tests/bidding.test.ts matches the intended rule and stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After an all-passed deal or a 20-20 draw, the first-card stake is x2, also after several in a row and in any mix of the two
- [x] #2 Tests cover: all-pass, draw, draw after all-pass, all-pass after draw
- [x] #3 rules/rules-nl.md, rules/rules-en.md and RULE_ASSUMPTIONS.md describe the x2 cap
- [ ] #4 The info panel does not show a multiplier on a level-2 hand, where it does not apply
- [x] #5 npm run bench shows that the bot win rate does not get worse
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Cap draw multiplier at 2 in engine.ts -> check: tests
2. Update types.ts comment -> check: grep
3. Add scoring test draw-at-x2-stays-x2 -> check: npm test
4. Update rules-nl/en + RULE_ASSUMPTIONS -> check: grep
5. Hide multiplier in InfoPanel at level 2 -> check: npm run build
6. npm run bench -> check: win rate + margin >= 50%
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cap x2 on draw in engine.ts (Math.min(m*2,2)); all-pass already sets 2. Added scoring test 'draw after all-pass stays x2'. rules-nl/en + RULE_ASSUMPTIONS updated. InfoPanel hides multiplier at level 2. npm test 153 pass, build pass, bench 50.0%±3.1%. Manual check: info panel must not show x2 badge during a level-2 hand.
<!-- SECTION:NOTES:END -->
