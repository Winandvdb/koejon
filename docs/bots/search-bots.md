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

## 8. Inference (#90)

Option `inference: { model: <algorithm spec> }` on `pimc`, `mcts` and `ismcts`
(`src/bots/inference.ts`). Each sampled world gets a weight: the product of the chances
that the model (`policy`) gives to the bids and troefke choices that the other seats made
this hand, each from that seat's own view then, with the hand it holds in that world. The
product has a floor of 0.05. `sampleWorld` keeps a world with a chance equal to its weight
(rejection sampling). The model reads no card play yet. A dealer's bid or choice is left
out: the dealer decides without seeing its hand, so the chance is the same in every world.
The trace gets one note with the effective sample size, (Σw)² / Σw², of the weights
computed for the decision.

The model is `heuristic:hard`. Its `policy` comes from the same code as its `decide`: each
random choice (`knijpChance`, `troefkeChance`, the dealer's choice, the lazy card) is a
branch with its chance. A bench of `heuristic:hard` against `origin/develop@heuristic:hard`
(200 matches per side, 400 played) gave exactly 50.0%, with the same decision counts.

### Benches

All with `heuristic:hard` bids, `--jobs 3`, while two other benches ran on the same Mac.
The match count is the count that the bench prints (each seed played twice, sides swapped).

| Bench | Matches | Win rate of the first bot |
|---|---|---|
| `pimc` 20 + inference, model replaces the bidder's troefke read (REPLACE) vs `pimc` 20 | 1000 | 51.1% ± 3.1% |
| `pimc` 20 + inference, multiplied with all of `troefkeWeight` (COMBINE) vs `pimc` 20 | 1000 | 50.7% ± 3.1% |
| `pimc` 20 + inference (REPLACE) vs the `hard` level (`pimc` 10, partner 2, anchor, margin 0.4) | 2000 | 62.6% ± 2.1% |
| `ismcts` 1000 + inference vs `ismcts` 1000 (cards only) | 1000 | 51.8% ± 3.1% |

REPLACE and COMBINE are equal within the noise. The code uses REPLACE: the model reads the
troefke itself (also a troefke not asked), and only the half of `troefkeWeight` that reads
an ignored troefke stays, because the model reads no card play. Against today's `pimc` the
gain is small (about +1 point, not significant). Most of the 62.6% against the `hard` level
comes from 20 worlds without the anchor, not from the inference: no bench of plain
`pimc` 20 against the `hard` level was run here.

### Time per decision

`--jobs 1`, both bots in one run, so they are measured back to back. Measured under load
(other benches on the Mac): the absolute times are too high, the ratio counts.

| Run (load average before / after) | Decision | With inference avg / max | Without avg / max |
|---|---|---|---|
| `pimc` 20, 40 matches (3.0 / 5.6) | card | 33.7 / 1025 ms | 33.7 / 1112 ms |
| | bidding (troefke by pimc, bids by heuristic) | 49.7 / 3557 ms | 60.3 / 4498 ms |
| `ismcts` 1000, 20 matches (5.6 / 2.9) | card | 91.9 / 1536 ms | 39.7 / 494 ms |

For `pimc` the inference costs no measurable time: 20 worlds, and a few rejected ones, each
with a few calls of the heuristic's bid policy, are small next to the solver. The max over
2.5 s is the troefke decision of `pimc` with 5 partner worlds, with and without inference.
`ismcts` weighs a new world in every iteration: about 2.3 times the average time and 3 times
the max. A cache of the weight per world, or fewer weighted worlds, can bring it down.

## Expert level baseline (#223)

**Final config** (`EXPERT_PIMC` in `src/bots/bot.ts`): `pimc` with `samples` 40, `partnerSamples` 1 and `inference: { model: 'heuristic:hard' }`, no anchor, no margin, and `heuristic:hard` for bids. Against the `hard` level: **65.4% ± 2.1%** (2000 games). Slowest decision on a quiet dev Mac: **1.9 s** (target 2.5 s), so about 3.7 s on a phone (a phone is about 2x slower, #172). See "Final timing and choice" below.

The first measurements (wave 1) follow. They ran under heavy load. `expert` = pimc without anchor and margin, `heuristic:hard` for bids. Candidates: `samples` 20 / 40 / 80, `partnerSamples` 5.
Opponent: the `hard` level bot (`pimc-hard` json: samples 10, partnerSamples 2, anchor `heuristic:hard` skill 1, margin 0.4).
Timing: `--jobs 1 --matches 20` (40 games), measured under heavy load on the dev Mac (load average 10 to 18, other benches ran at the same time), so every time is inflated.

| samples | win rate vs hard (20 matches, noise only) | bid/troefke avg ms | bid/troefke max ms | play avg ms | play max ms |
|---|---|---|---|---|---|
| 20 | 62.5% ± 15.0% | 62 | 4167 | 35 | 1992 |
| 40 | 62.5% ± 15.0% | 150 | 10247 | 74 | 2457 |
| 80 | 75.0% ± 13.4% | 254 | 15355 | 141 | 4123 |
| hard (10/2, for reference) | | 14.5 | 1562 | 18.7 | 1026 |

Win rate against the `hard` level bot, seats swapped (each seed is played twice), run with `--jobs 3` under heavy and varying load (the Mac paused for hours, so the max times of these runs are not valid and are not given; the avg times are inflated):

| samples | matches | win rate vs hard | avg ms bid/troefke | avg ms play |
|---|---|---|---|---|
| 20 (`partnerSamples` 5) | 1000 (2000 games) | 60.8% ± 2.1% | 96.7 | 51.3 |
| 40 (`partnerSamples` 5) | 500 (1000 games) | 65.6% ± 2.9% | 393.3 | 230.1 |
| 80 (`partnerSamples` 5) | not run | 75.0% ± 13.4% in the 20-match timing run (noise) | | |

(`hard` in the same runs: 19.3 / 24.2 ms avg in the 20-sample run.)

Choices:

- 80 samples is rejected on time: the slowest decision was 15 s in the timing run, far over the 2.5 s limit, so its win rate was not benched at 1000 matches.
- Wave 1 kept `EXPERT_PIMC` at 20 / 5 as a placeholder. Wave 2 below replaces it.
- 60.8% ± 2.1% does not yet prove the 60% target (the lower bound is 58.7%). The 40-sample point is higher (65.6% ± 2.9%) but its slowest decision (10 s in the loaded timing run) is also over the limit.
- The slowest decisions are bid/troefke decisions (partner model with `partnerSamples`).

### Final timing and choice (wave 2)

After the merge of #90 (`inference`). Each candidate against the `hard` level bot (`pimc-hard`
json above), `npm run bench -- --a <cfg> --b <hard> --matches 20 --jobs 1` (40 games, both bots
timed in the same run). A run started only when the 1-minute load average was below 4; other
agents used the Mac during some runs, so the load after the run is also given. Times are per
real decision; bid/troefke = the `bidding` count of the bench (the troefke by pimc, bids by
`heuristic:hard`). The win rates of 40 games are noise only.

| Config (`samples` / `partnerSamples`, inference) | Load before / after | bid/troefke avg / max ms | play avg / max ms | Win rate (40 games) |
|---|---|---|---|---|
| 20 / 1, inference | 3.75 / 12.90 | 15.4 / 1362 | 36.3 / 1235 | 67.5% ± 14.5% |
| 20 / 1 | 3.45 / 4.97 | 13.6 / 1049 | 34.5 / 1499 | 57.5% ± 15.3% |
| 20 / 2, inference | 3.85 / 3.06 | 28.0 / 1903 | 34.2 / 1039 | 65.0% ± 14.8% |
| 20 / 2 | 3.06 / 5.16 | 22.9 / 1771 | 33.0 / 1404 | 60.0% ± 15.2% |
| 20 / 3, inference | 3.30 / 6.80 | 40.0 / 2382 | 34.0 / 1169 | 67.5% ± 14.5% |
| 20 / 3 | 2.13 / 2.41 | 35.4 / 2378 | 33.0 / 1391 | 62.5% ± 15.0% |
| 30 / 1, inference | 2.41 / 2.13 | 22.6 / 1520 | 49.6 / 1718 | 62.5% ± 15.0% |
| 40 / 1, inference | 2.13 / 7.58 | 27.7 / 1813 | 65.6 / 1865 | 62.5% ± 15.0% |
| `hard` (10 / 2, anchor; from the same runs) | | 12.8 to 15.1 / 1421 to 1528 | 16.8 to 18.0 / 552 to 785 | |

All candidates stay under 2500 ms for every decision kind. `partnerSamples` drives the
troefke cost: 1 → 2 → 3 partner worlds gives a max of about 1.4 → 1.9 → 2.4 s at 20 samples.
More `samples` drive the card time.

Full benches against the `hard` level, `--matches 1000 --jobs 3` (2000 games, sides swapped),
one bench at a time:

| Config | Load before / after | Win rate | Lower bound |
|---|---|---|---|
| 20 / 2, inference | 3.77 / 6.84 | 61.8% ± 2.1% (1235/2000) | 59.7%: fails the 60% target |
| **40 / 1, inference** | 3.08 / 8.10 | **65.4% ± 2.1% (1308/2000)** | **63.3%: meets it** |

The max times of these runs (2.5 s and 4.9 s) come from 3 parallel jobs with the load going
up to 8 from other work on the Mac. They are not valid timings; the table above is.

Choice: `EXPERT_PIMC` = 40 / 1 with inference. 20 samples with inference was preferred, but
20 / 2 fails the target by 0.3 points. 40 / 1 gives 4 points more for a slowest decision of
1.9 s on the Mac (about 3.7 s on a phone). Its average card decision is about 2x that of
20 samples (66 against 34 ms).
