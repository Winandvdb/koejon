# Search bots: pimc, mcts and ismcts

Issue: #87, PR #176 (2026-10-11). Question: are the pure MCTS bots (`mcts`, `ismcts` in
`src/bots/mcts.ts`) a better base for the `hard` level than `pimc` (`src/bots/pimc.ts`)?

Short answer: no. `ismcts` is about as strong as `pimc` at equal time, and `mcts` is weaker.
`pimc` uses less time on a phone, plays more like a human and is more stable. The `hard`
level stays on `pimc` (`LEVEL_CONFIGS.hard` in `src/bots/bot.ts`), and #178 (anchor to the
heuristic card) builds on `pimc`. `mcts` and `ismcts` stay in the registry for benches and
later work.

## 1. The three algorithms

All three sample worlds with `sampleWorld`: the unseen cards dealt at random, so that they
agree with what the seat saw.

| Algorithm | How it values an action |
|---|---|
| `pimc` | Per world, the solver (`solve`) gives the exact double-dummy value of every card. The card with the best average over the worlds wins. Every card is valued on the same worlds. |
| `mcts` | Per world, one UCT tree with full information and random playouts. The root visits of all worlds are added. `iterations` is the budget of the full decision, so 1000 iterations over 10 worlds is 100 per world. |
| `ismcts` | One tree for the seat's information set. Each iteration takes a new world and plays one path through the tree, then a random playout. Availability counts in UCB. |

`pimc` and `mcts` decide per world with full information, then average ("strategy fusion": a
plan that needs to see the hidden cards looks possible). `ismcts` keeps one tree over all
worlds, so it suffers less from this. `pimc` makes up for it with exact values per world;
`mcts` has noisy values from random playouts and does not.

## 2. Time per decision

One thread on the development Mac, 60 real decisions of seed 1:

| Algorithm | ms per decision |
|---|---|
| `mcts` 1000 iterations | 4.7 |
| `ismcts` 1000 iterations | 75 |
| `pimc` 20 samples (the default) | 167 |

The time of `pimc` falls fast in a hand: the solver has less work with fewer cards. For the
`hard` level (`HARD_PIMC`: 10 samples, 2 partner samples), PR #174 measured 72 ms for a card
on the first trick and 2.5 ms on a later trick. The time of `ismcts` stays about the same
for every card, because it samples a world in every iteration. So for the same strength
`ismcts` costs more on average on a phone host.

## 3. Strength

All benches: `npm run bench`, 9 jobs. Win rate of the named bot. "own bids" = the algorithm
decides everything. "hard bids" = the algorithm plays the cards
(`{"when":{"phase":"play"}}`), `heuristic:hard` decides the bids, the troefke and the
dealer's choice. The `pimc` side is `{"rules":[{"use":"pimc"},{"use":"heuristic:hard"}]}`
with the default 20 samples.

### Against `heuristic:hard`, 200 matches

After the review fixes of PR #176:

| Bot | Win rate |
|---|---|
| `mcts` 1000, own bids | 80.0% ± 5.5% |
| `ismcts` 1000, own bids | 84.5% ± 5.0% |

Both are clearly stronger than the heuristic. PR #176 has the other budgets (300, 3000,
MAST) from before the fixes.

### Against `pimc` at equal time, 200 matches

The budgets give about the same time per card as `pimc`.

| Bot | Win rate | ms per card, bot / `pimc` |
|---|---|---|
| `mcts` 13000, hard bids | 43.5% ± 6.9% | 112.1 / 89.6 |
| `mcts` 13000, own bids | 31.5% ± 6.4% | 105.8 / 86.5 |
| `ismcts` 1000, hard bids | 48.5% ± 6.9% | 101.5 / 95.3 |
| `ismcts` 1000, own bids | 47.0% ± 6.9% | 96.5 / 92.4 |

- `ismcts`: 50% is inside the margin in both runs. No proven difference from `pimc`. To show
  a difference of 2 points, a bench needs a few thousand matches.
- `mcts` loses to `pimc`, also with 13 times more iterations than `ismcts`.

## 4. Bidding

`pimc` cannot bid: it bids far too often, so it uses `heuristic:hard`. `mcts` and `ismcts`
bid with their own tree.

| Bot | 1st / 2nd card bid rate | Bids with 0 / 1 trump |
|---|---|---|
| `heuristic:hard` bids (the `pimc` side, self-play) | 7.9% / 19.7% | 0.0% / 0.7% |
| `mcts` 13000 | 11.9% / 19.8% | 1.5% / 11.0% |
| `ismcts` 1000 | 13.0% / 20.9% | 0.0% / 2.9% |

- Against `pimc`, the own bids of `ismcts` cost about 1.5 points (inside the margin). Its
  bids are usable.
- The own bids of `mcts` cost about 12 points. Use `mcts` only with `heuristic:hard` bids.
- In a hand-made check, pure MCTS also passes with five top trumps at low budgets: after a
  pass, the opponents in the tree still bid badly, so a pass looks as good as a bid.

## 5. Human-like play (#178)

Players find the `hard` level strange to play with: its cards are hard to predict. #178
measured this for `pimc`. The same probe for `ismcts`: 8 seeded matches (seeds 1 to 8), four
seats with the same bot, `heuristic:hard` bids. At each real card choice, `heuristic:hard`
was also asked, and the bot was asked again with other random worlds.

| Check | `pimc` 10 (the `hard` level) | `ismcts` 1000 |
|---|---|---|
| Real card choices | 1332 | 1576 |
| ms per card choice | 25.6 | 54.9 |
| Another card than `heuristic:hard` | 38.7% | 49.7% |
| Another card with other random worlds | 25.7% | 31.0% |
| When they differ: own card 0.2 lines better or less | 53.5% | 63.1% |
| When they differ: an exact tie | 37.4% | 10.6% |
| When they differ: visits of the heuristic card (median) | – | 258 |

The `pimc` column agrees with #178 (39% and 26%), so the probe measures the same thing.

- `ismcts` leaves the human card more often and changes its card more often with other
  worlds. Most of these changes give almost nothing.
- An anchor as in #178 fits `pimc` best: it compares two cards on the same worlds with exact
  values. In `ismcts` the two cards see other worlds, so a margin test is noisier. The
  heuristic card usually has enough visits (under 50 in less than 2% of the cases), so a
  margin is possible, but it needs a real margin: exact ties are rare.

### The anchor in `pimc` (#178)

`pimc` got the options `anchor` and `margin`: it plays the anchor's card unless its own best
card is more than `margin` lines better on the same worlds. Each margin with
`anchor: 'heuristic:hard'` and the `hard` worlds (`samples` 10, `partnerSamples` 2):

| Margin | Another card than `heuristic:hard` | Another card with other worlds | Win rate against the `hard` level without anchor (1000 matches) |
|---|---|---|---|
| none | 39.2% | 25.9% | – |
| 0 | 27.4% | 23.7% | 49.6% ± 3.1% |
| 0.1 | 22.8% | 19.6% | 49.1% ± 3.1% |
| 0.25 | 20.5% | 18.9% | 48.2% ± 3.1% |
| 0.5 | 11.3% | 12.0% | 40.6% ± 3.0% |

The first two columns come from 8 seeded matches per margin, all four seats with the
anchored bot. A margin of 0.5 fails the bench rule: the small gains add up over a match. #178
gave the `hard` level 0.25, the largest margin tried that passes. #183 changed it (below).

### No lazy dump as the anchor card, and a wider margin (#183)

`heuristic:hard` plays about 5% of its cards as a lazy dump (`skill: 0.95`): a planned
mistake. As the anchor card, pimc kept such a card when its own card was not more than the
margin better. The anchor is now `{ id: 'heuristic:hard', skill: 1 }`: the heuristic option
`skill` overrides the level's skill, and with 1 it never dumps. On `normal` and `hard` a lazy
dump draws no extra random number, so `skill` changes only the dumps, not the rest of the
match. On `easy` a lazy card is a random card, which draws one more number.

Hand values are whole lines, so with 10 worlds pimc's gain is a multiple of 0.1: a margin of
0.25 acts as 0.2, 0.3 and 0.35 act the same, and 0.45 acts as 0.4.

The probe is `node scripts/bot-probe.mjs --bot <spec>` (seeds 1 to 8, all four seats the
same bot; `--ref` sets the reference). "Plain" is the reference `heuristic:hard`, "skill 1"
is `{"id":"heuristic:hard","skill":1}`. The bench is `npm run bench -- --matches 500 --level
hard --a <spec>` against `develop` after #178 (anchor `heuristic:hard`, margin 0.25).

| Anchor, margin | Another card than plain / skill 1 | Another card with other worlds | Win rate against `develop` (1000 matches) |
|---|---|---|---|
| `heuristic:hard`, 0.25 (`develop`) | 21.0% / 19.5% | 18.5% | – |
| skill 1, 0.25 | 22.0% / 20.4% | 17.4% | – |
| skill 1, 0.3 | 18.6% / – | 15.9% | same as 0.35 |
| skill 1, 0.35 | 18.6% / 16.5% | 15.9% | 49.7% ± 3.1% |
| skill 1, 0.4 | 15.5% / 13.9% | 13.0% | 47.7% ± 3.1% |

Both benched margins pass the bench rule. The `hard` level uses 0.4 (`HARD_ANCHOR_MARGIN`),
the largest margin tried that passes: its card changes with other worlds in 13% of the
choices, against 18.5% before. The win rate falls with the margin, and 0.4 passes by 0.8
points only: do not widen it further without a new bench.

## 6. Decision

The `hard` level stays on `pimc` with `heuristic:hard` bids:

1. `ismcts` is not stronger at equal time, and `mcts` is weaker.
2. `pimc` is fast after the first trick, so it fits the phone budget of #172 better.
3. `pimc` plays more like a human and is more stable, and #178 can make it more human-like
   with an exact, paired comparison.

## 7. Open points

- An `ismcts` anchor: a prior on the heuristic card (progressive bias: virtual visits at a
  good value) or a margin on the root means. Not needed while `hard` uses `pimc`.
- Heuristic playouts in `ismcts` (the other seats play like `heuristic:hard`, not at
  random). This can make it stronger and more human-like, but the heuristic works on the
  engine state, not on the bitmask `Hand`.
- `c` (0.7) and the MAST settings are not tuned.
- No `ismcts` timing on a real phone.
