---
id: task-3
title: Interactive packet lift for the cut (afpakken) and the dealer draw
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-06 09:12'
labels: []
dependencies:
  - task-1
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Players lift a packet of cards from the deck themselves, as at a real table. The same interaction is used for the dealer draw at the start of a match and for the cut (afpakken) before each deal. Bots lift a packet automatically.

Today the dealer draw is a "Draw" button and the engine picks a random packet size (src/engine/engine.ts, case 'draw'). The engine also shuffles a new deck for each of the two draws, so team B does not draw from what team A left. With an interactive draw, team A's packet must decide what is left for team B.

The cut only has an effect once the deck is no longer reshuffled each deal (task-1), so this task waits for task-1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A player can lift a packet of cards from the deck by touch or mouse, and sees the packet before they confirm; no card count is shown
- [x] #2 Dealer draw, team A: at least 4 cards lifted and at least 8 left; the bottom card of the packet is shown to all players
- [x] #3 Dealer draw, team B: lifts from the cards team A left, at least 4 lifted and at least 4 left; the deck is not reshuffled between the two draws

- [x] #4 A tie in the dealer draw starts again with a newly shuffled deck
- [x] #5 Cut: the right neighbour of the dealer lifts at least 4 cards and leaves at least 4; the cut is applied to the deck before the deal
- [x] #6 Bots lift a valid packet automatically, in the dealer draw and in the cut
- [ ] #7 All other players see who is lifting and the result
- [x] #8 Tests cover the limits of both actions, the same deck for both draws, and the tie
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Engine: dealer draw keeps one hidden shuffled deck per attempt; action draw carries packet size n (A: 4..16, B: 4..remaining-4); tie reshuffles -> check: dealerdraw tests (limits, same deck, tie) [AC2,3,4,8]
2. Engine: new phase CUTTING before DEALING; right neighbour (dealer+3)%4 sends cut n in 4..20; cut applied to the deck before the deal -> check: deal/piles tests [AC5,8]
3. Hide the draw deck from toPublic; log n for draw and cut -> check: privacy test [AC7]
4. Bots pick a random legal packet; host stops auto-drawing for humans -> check: simulation + solo tests [AC6]
5. UI: PacketLift component (stack + slider, count, confirm) for draw and cut; others see who lifts and the result; i18n nl+en -> check: build; manual check at phone width [AC1,7]
6. Update rules text, RULE_ASSUMPTIONS, AGENTS.md if needed -> check: review diff
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Engine: dealer draw keeps one hidden shuffled deck per attempt (DealerDraw.deck, stripped by toPublic); action draw carries packet size n (A 4..16, B 4..remaining-4); tie reshuffles. New phase CUTTING before every deal: right neighbour sends cut n (4..20), cut applied to the piles, then DEALING. liftRange()/cutterOf() in engine.ts.
Bots pick a random allowed size. Host no longer auto-draws for humans.
UI: new src/components/PacketLift.svelte (deck stack drag + slider, count, Lift button) in Table.svelte for draw and cut; others see who lifts; DEALING panel shows the cut. i18n nl+en.
Tests: dealerdraw.test (limits, same deck, tie, deck hidden), deal.test (cut limits, cut applied), bot.test (bot lift), piles/helpers updated.
Docs: rules-nl/en, RULE_ASSUMPTIONS, AGENTS.
Manual check: lift by touch and mouse at phone width; other players see who lifts and the result.
npm run bench cannot compare against origin/develop: the base engine has no packet size on draw.
<!-- SECTION:NOTES:END -->
