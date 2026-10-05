---
id: task-4
title: Fine-tune bot bidding decisions
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-05 15:21'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bots almost always bid ('ik ga') on the first turned card. They do not consider that a second turned card could suit their hand better, so the second card is rarely turned. They also bid with no trump or a single trump, which real players almost never do. Tighten the bidding heuristics in src/bots/bot.ts. Card-play improvements live in a separate task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bots bid 'gaan' less often on weak hands
- [x] #2 Bots pass more often, so the second card gets turned more often
- [x] #3 Bots never bid with 0 trump in hand

- [x] #4 Bots bid with exactly 1 trump only very rarely, and only with a really strong hand
- [x] #5 Bot win rate in the match simulation does not get worse
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add scripts/bot-benchmark.mjs (npm run bench): this checkout vs a git ref, both team sides per seed, win rate with 95% interval and bidding stats -> check: against HEAD it gives 50.0%
2. Bid gate: never bid with 0 trumps; with 1 trump only if it is K/A and rating >= 13 -> check: new tests in tests/bot.test.ts, benchmark trump counts
3. Raise 1st-card threshold 10 -> 11 so weak hands pass and the 2nd card turns more often -> check: benchmark bid rates and 2nd-card rate
4. Benchmark vs origin/develop at all levels -> check: win rate not below 50%
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Bidding in src/bots/bot.ts: no bid with 0 own trumps (also no knijpen or decisive bid); 1 trump only if it is K or A and rateHand >= 13 (LONE_TRUMP_MIN); BID_THRESHOLD_1 10 -> 11. Tests in tests/bot.test.ts (knijpen TRASH hand now has 2 low trumps). New scripts/bot-benchmark.mjs (npm run bench): 500 seeds x 2 sides vs origin/develop. Win rate: normal 61.0% +-3.0, easy 58.3% +-3.1, hard 60.8% +-3.0. Self-play (normal): 1st card bid rate 33.8% -> 19.5%, 2nd card bid rate 53.4% -> 42.5%, 2nd card turned 27.0% -> 51.0% of hands, bids with 0 trump 2.5% -> 0%, with 1 trump 22.5% -> 1.4%.
<!-- SECTION:NOTES:END -->
