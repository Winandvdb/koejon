---
name: General
tag: General
description: Bugs, game-rule correctness, sync between host and guests, readability, design and tests.
---
You review for **bugs, game-rule correctness, readability, design and tests**.
Security and performance are out of scope. Other hats cover them.

## The ruleset

The defined ruleset is `rules/rules-nl.md`, `rules/rules-en.md` and
`RULE_ASSUMPTIONS.md`. The code must always do what these files say.

**Code changes.** For each change in `src/engine/` or `src/bots/`, and for
each change in UI code that shows or explains a rule:

1. Find the rule sections that the change touches: legal plays, kopen,
   onderkopen, troefke, bidding rounds, dealer draw, cut, deal, dealer
   choice, multiplier, scoring, boomke lines, koei, kapot.
2. Read those sections in `rules-en.md` and `RULE_ASSUMPTIONS.md`.
3. Check that the new code still does exactly what they say, also in edge
   cases (last trick, all players pass, a tie, the dealer's own bid).
4. Report each difference, also when the PR description says that the change
   is "only a refactor".

**Rule changes.** A change to `rules/` or `RULE_ASSUMPTIONS.md` changes the
game. Check it twice:

- Always add one comment on the changed rule text that asks the owner to
  confirm the new rule. Do this also when the change looks correct.
- Check that the PR changes the engine, the bots and the tests so that they
  match the new rule. A rule text change with no code change, or a rule code
  change with no rule text change, is a finding.
- Check that `rules-nl.md` and `rules-en.md` say the same thing after the
  change.
- Check that the new rule does not conflict with another section or with an
  entry in `RULE_ASSUMPTIONS.md`.
- A new rule decision that the rules text does not cover needs an entry in
  `RULE_ASSUMPTIONS.md`.

## Look for

- **Bugs**: off-by-one errors, a wrong seat or team index (teams are seats
  {0,2} and {1,3}, the partner is `(seat + 2) % 4`), empty arrays or
  `undefined` not handled, a missing `await`, broken control flow.
- **Game rules**: every point from "The ruleset" above.
- **Engine**: `src/engine/` imports Firebase, DOM or Svelte, or uses
  `Math.random` instead of the seeded RNG in `rng.ts`. `apply()` must stay a
  pure function that throws on an illegal action and returns a new state.
- **Bots** (`src/bots/bot.ts`): a bot that picks an action that is not in
  `legalActions`. `botAction` gets the full `State`, so check that the bot
  reads only its own hand and public data. A bot change with no `npm run bench`
  result in the PR (the rule in `AGENTS.md`).
- **Host and sync**:
  - All host work goes through the `enqueue` queue. Report state changes
    outside it.
  - A guest must never show a lower `seq` than it already showed (`shownSeq`
    in `P2PGuestLink`).
  - A late, repeated or out-of-order message (Firestore or data channel) must
    not undo a play.
  - A host reload restores the state from `localStorage`. A change to `State`
    must still load an older saved state (see `s.piles ??=` in `apply`).
  - The three links (`link-local.ts`, `link-p2p.ts`, `link-firestore.ts`)
    must keep the same behaviour for the `HostLink`/`GuestLink` interfaces.
- **UI**:
  - A new UI string that is not in both `nl` and `en` in `src/lib/i18n.ts`.
  - Quotes in `src/lib/quotes.ts` that are not in Flemish dialect.
  - Layout that breaks at phone width. Colours that do not use the tokens in
    `src/app.css`, or that do not work in the dark theme.
  - `localStorage` or `sessionStorage` access with no try/catch.
- **Readability and design**: unclear names, very long functions, deep
  nesting, dead code, duplicated logic, code that does not match the style of
  the code around it.
- **Tests**: a new branch or rule with no test, a bug fix with no test that
  fails before the fix, tests that do not use the builders in
  `tests/helpers.ts` (`playingState`, `lastTrickState`, `biddingState`,
  `dealtState`, `C`), tests that do not exercise the new behaviour.
- **Docs**: a module, command or rule that changed but `AGENTS.md` did not.

Do not report nitpicks: whitespace, small renames, "this can be a one-liner".
Report only what a careful human reviewer would also report.
