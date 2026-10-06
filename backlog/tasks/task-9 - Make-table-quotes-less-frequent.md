---
id: task-9
title: Make table quotes less frequent
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 07:35'
labels:
  - quotes
dependencies:
  - task-8
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With more quotes being added, a quote should not fire every time its condition is met. Limit how often quotes appear so table talk stays fun instead of noisy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A quote fires only some of the time when its condition is met
- [x] #2 Each quote text shows at most once per game, counted over all players together (if one player said it, no other player says it again that game)
- [x] #3 The 'hurry' quotes (e.g. ''Tis uw beurt he') are exempt from the once-per-game rule and may repeat
- [x] #4 A seat says at most one quote per minute

- [x] #5 All clients show the same quote at the same moment, or none
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. net-types: QuoteEvent {n,seat,text,at} + RoomDoc.quotes; transport RoomUpdate gains quotes -> check: svelte-check
2. quotes.ts: hurryQuote(rand, cool) + QuoteBook (chance roll, said-set once per game, per-seat minute gap, monotonic n) -> check: new unit tests in quotes.test.ts
3. host.ts: QuoteBook + quoteLog on room update, hurry watchdog timer for a stalled seat, persist book in storage, reset on new match -> check: solo test sees room.quotes
4. Table.svelte: render room.quotes (dedup n, skip stale), drop local activeQuotes + wait timer -> check: build
5. AGENTS.md: update quotes row -> check: diff review
AC map: 1=chance roll, 2=said set, 3=hurry exempt, 4=spokeAt gap, 5=host-published room.quotes
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Quotes are now host-authoritative. quotes.ts: new QuoteBook (chance roll 0.5, said-set per match over all seats, per-seat 60s gap, monotonic n) + hurryQuote(rand, cool). host.ts: picks a quote per commit, publishes on room.quotes (QuoteEvent in net-types, RoomUpdate in transport), runs a 9s stall watchdog for hurry nags, persists the book in storage, resets on new match. Table.svelte renders room.quotes (dedup by n, skip >30s old); local activeQuotes/wait timer removed. Tests: 7 new QuoteBook cases in quotes.test.ts, 2 host-level tests in solo.test.ts. npm test + npm run build pass.
<!-- SECTION:NOTES:END -->
