---
id: task-3
title: Interactive packet lift for the cut (afpakken) and the dealer draw
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-09-30 19:43'
updated_date: '2026-10-06 09:03'
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
- [ ] #1 A player can lift a packet of cards from the deck by touch or mouse, and sees how many cards they lift before they confirm
- [ ] #2 Dealer draw, team A: at least 4 cards lifted and at least 8 left; the bottom card of the packet is shown to all players
- [ ] #3 Dealer draw, team B: lifts from the cards team A left, at least 4 lifted and at least 4 left; the deck is not reshuffled between the two draws

- [ ] #4 A tie in the dealer draw starts again with a newly shuffled deck
- [ ] #5 Cut: the right neighbour of the dealer lifts at least 4 cards and leaves at least 4; the cut is applied to the deck before the deal
- [ ] #6 Bots lift a valid packet automatically, in the dealer draw and in the cut
- [ ] #7 All other players see who is lifting and the result
- [ ] #8 Tests cover the limits of both actions, the same deck for both draws, and the tie
<!-- AC:END -->
