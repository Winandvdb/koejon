---
base: da4d6f7faa3e2aabf920cb1992f8015da9358233
audited-base: da4d6f7faa3e2aabf920cb1992f8015da9358233
audited-head: 7efe1b471f9d2ceb0293af221747f6a9f788fd15
implementation: 7efe1b471f9d2ceb0293af221747f6a9f788fd15
head: 7efe1b471f9d2ceb0293af221747f6a9f788fd15
reviewers: /code-review high
harness: claude-code
session: 0cc4ca2f-7497-4c5f-9a71-707be7c4c084
fixed-in: HEAD
anchors: review-commit
---

## Fixed

### Pile moved with the shrinking hand and fell onto the nameplate
- file: src/app.css:1425
- file: src/app.css:1433-1442
- source: /code-review high
- severity: medium
- observation: The pile is placed against `.opp-hand`, which shrinks with each played card and collapses to 0x0 when the hand is empty. During SCORED, when the pile is largest, it lands on the partner's nameplate.
- fix: Give `.opp-hand` the minimum size of a full six-card hand, so the anchor does not move.

### Pile grew while the trick still lay on the felt
- file: src/components/Table.svelte:95-97
- file: src/components/Table.svelte:269-270
- file: src/components/Table.svelte:282
- source: /code-review high
- severity: low
- observation: `tricksWon` goes up when the trick completes, so the pile shows the trick while its four cards still lie in the centre. The trick is shown twice.
- fix: `pileCount` leaves out a trick that still lingers during PLAYING; after the last trick it counts at once.

### Fan offsets in fixed px did not scale with the card
- file: src/components/Table.svelte:285
- file: src/app.css:1513-1520
- source: /code-review high
- severity: low
- observation: The card offsets (`k*3px`, `-k*4px`) and the 20/28 px gaps are fixed, but the pile card scales with `--card`. On phones the fan is large compared to the card.
- fix: Express every offset and gap as a fraction of `--cw`.

### First pile card had no scale-in
- file: src/components/Table.svelte:280
- source: /code-review high
- severity: low
- observation: Svelte 5 transitions are local. The `in:scale` on the first card does not play, because the card is created together with its `{#if}` block.
- fix: Put the same `in:scale` on the `.trick-pile` wrapper.

### Second `.opp-hand` rule only for `position: relative`
- file: src/app.css:1425
- source: /code-review high
- severity: low
- observation: A second `.opp-hand` rule, far from the first, only adds `position: relative`. A reader of the first rule does not see that it is a positioning context.
- fix: Move `position: relative` into the original rule.

## Ignored

### Pile shows trick counts when the host turned scores off
- file: src/components/Table.svelte:269
- source: /code-review high
- severity: low
- observation: The pile ignores `opts.score`, so trick counts are visible even when the host hides points and tricks.
- why: On a real table the piles are visible; the human asked for countable tricks.

### Trick cards fly to the winner, not to the team pile
- file: src/components/Table.svelte:92
- source: /code-review high
- severity: low
- observation: The lingering trick flies toward the winner's seat, but the pile sits at the partner or the left opponent.
- why: The existing fly-out to the winner is outside this ticket; the winner collects the trick.

### New test only checks the engine counter, not the UI rule
- file: tests/piles.test.ts:94
- source: /code-review high
- severity: low
- observation: The test asserts public `tricksWon`, not the snippet's phase guard, seat choice or ring class.
- why: There is no Svelte component test setup; adding one needs new dependencies.

## Assumptions

### One pile per team: ours at the partner, theirs at the left opponent
- file: src/components/Table.svelte:310
- alternative: Pile at the seat that won each trick, or ours at my own seat.
- why: The ticket says "next to that team", and a team is two seats; my own seat area is crowded with the hand, hints and the boomke chip. The human saw this placement and asked only for clearer ownership, which pushes it up; the winner-seat reading still makes sense, which pulls it down.
- confidence: 0.6

### Team shown by a ring in the nameplate colour
- file: src/app.css:1510-1516
- alternative: A label ("Wij"/"Zij") or a count badge under the pile.
- why: The human asked to make ownership clear but not how; red and blue already mean playing and defending team on the nameplates. A label would be clearer to a new player, so it is not certain.
- confidence: 0.65

### Piles show only in PLAYING, SCORED and GAME_OVER
- file: src/components/Table.svelte:275
- alternative: Keep the piles through CUTTING and DEALING until the actual deal.
- why: After "next hand" the piles become the new deck at the cut, so on a real table they are gone by then. The ticket says "clears at the next deal", which is a little later, so this is a close reading.
- confidence: 0.75

### One face-down card per trick, not four
- file: src/components/Table.svelte:289
- alternative: Four cards per trick, crossed as on a real table.
- why: The human asked that the tricks can be counted, and one card per trick makes the count direct. Four cards per trick would look closer to a real table.
- confidence: 0.8

### Keep a full-hand minimum size for every opponent hand
- file: src/app.css:1443-1452
- alternative: A fixed anchor element for the pile only, leaving the hand box free to shrink.
- why: A stable hand box is the smallest fix, and the seat already reserves this space for most of a hand. It also applies when no pile shows (lobby, dealer draw), and I did not check those layouts on screen.
- confidence: 0.6
