# Spike: a bidding strategy with MCCFR

Issue: #92 (2026-10-31). Question: can we compute the bids of a bot offline with Monte Carlo
Counterfactual Regret Minimization (MCCFR), store them as a table, and let a new algorithm
`cfr` play the table? Context: the `expert` level (#223) must beat the `hard` level in at
least 60% of the matches and should use no heuristic. Today all bids, the troefke ask and the
dealer's choice of the `hard` level come from `heuristic:hard` (`LEVEL_CONFIGS` in
`src/bots/bot.ts:112`).

Short answer: **yes, with a small abstract game.** The bidding game is short (at most 7
decisions per deal, 2 actions each). The cost is not the CFR loop, it is the value of the
leaves: each leaf is a played hand. We cache those values per bucket. Estimates on the
development Mac (Apple M2 Pro, 10 cores): about 3.4 hours in total (range 2.5 to 3.8), of which
about 2.9 hours (range 2.2 to 3.2) is card play in the cache and about 27 minutes (range 18 to
37) is the MCCFR loop. The table is about 0.36 MB.

No code is written yet. This write-up is what the user must agree first (acceptance criterion
1 of the issue). Section 7 lists the questions.

All numbers marked *measured* come from throwaway scripts outside the repo (section 4). Numbers
marked *estimate* are not measured.

## 1. Decisions in scope (AC1)

The engine knows these actions for bidding. The bots see the same list as `obs.legal`.

| Decision | Phase | Seat | Legal actions | Engine |
|---|---|---|---|---|
| Bid, 1st turned card | `BIDDING_R1` | `(dealer + 1 + bidIndex) % 4`, `bidIndex` 0..2 | `{bid, play: true}`, `{bid, play: false}` | `legalActions` `engine.ts:195-199`, `pendingSeats` `engine.ts:123-125` |
| Bid, 2nd turned card | `BIDDING_R2` | same, only if the 2nd card has another suit than the 1st | the same two bids | `engine.ts:195-199`, transition at `engine.ts:483-490` |
| Dealer's choice | `DEALER_CHOICE` | the dealer | `{choose, suit}` per suit in `choiceSuits` (one suit if both turned cards share it, else two), and `{choose, suit: null}` (pass) | `engine.ts:201-206`, `choiceSuits` `engine.ts:165-169` |
| Troefke ask | `PLAYING`, before the first lead | the bidder, while its partner has to lead. The first leader is always position 0 (`engine.ts:309`), so only a bid by position 2 can ask | `{troefke}` next to the `{ack}`; asking is optional | `engine.ts:211-223`, applied at `engine.ts:523-528` |

How the actions work:

- A `bid` with `play: true` ends the bidding. Trump is the suit of the first turned card
  (level 1) in round 1, and of the second turned card (level 2) in round 2
  (`engine.ts:476-481`, `startPlaying` `engine.ts:305-313`). A pass moves to the next seat.
  After 3 passes, round 1 turns the second card; with the same suit the game goes straight to
  `DEALER_CHOICE`, else to `BIDDING_R2` (`engine.ts:483-490`).
- The dealer never bids. The dealer chooses after 6 passes (or 3 passes with a same-suit
  second card). A `choose` with a suit is always level 2. `choose` with `null` is the
  all-pass: `allPassed` (`engine.ts:315-327`) sets the multiplier to 2, passes the deal to the
  left neighbour and throws the hands in as they are.
- The dealer may not look at the own cards while bidding. `obs.hand` is empty for the dealer
  (`observation.ts:12-13`), so the dealer's choice depends on the two turned cards only.
- **Knijpen is not an action.** It is a `bid` with `play: true` in round 1 on a hand that is
  only fair: the bidder takes a level-1 stake (1 line times the multiplier) instead of waiting
  for the level-2 stake (2 lines, never multiplied). `heuristic.ts:678-680` names it. In the
  abstract game it must come out of the values: pass in round 1 leads to the continuation of
  round 2.
- **Troefke is not a bid.** `decisionPhase` counts it as `bidding`
  (`observation.ts:28-29`), and the bot decides it with the `ack` (`heuristic.ts:659-663`,
  `pimc.ts:121`). The partner may ignore it (`conventions.ts:14-45`). Section 7, Q3 asks if
  `cfr` should take it.

The multiplier and the lines enter the payoff, not the actions:

| Effect | Engine |
|---|---|
| Stake = multiplier on level 1, 2 on level 2 | `engine.ts:361` |
| Kapot adds 1 line to the winner | `engine.ts:360, 362` |
| Defenders win: the playing team gets a koei (+1 line) | `engine.ts:363, 384-388` |
| 20-20: no lines, next level-1 stake x2 | `engine.ts:358, 401` |
| All pass: no lines, next level-1 stake x2 | `engine.ts:317` |
| The multiplier never goes above 2 | `engine.ts:401`, `RULE_ASSUMPTIONS.md` |

## 2. The abstraction (AC2)

### 2.1 What a seat knows

A bidder knows: its 6 cards, the first turned card (the dealer's last card, face up), in
round 2 also the second turned card, the multiplier, both line counts, and the history.

The history is short. A `play: true` ends the bidding, so every earlier bid in the hand is a
pass. The history is therefore only the round and the position `p` of the seat:
`p = (seat - dealer - 1) mod 4`, so 0 (left of the dealer), 1 (the dealer's partner), 2
(right of the dealer). That is the "seat relative to dealer" and "earlier bids this hand" of the
issue, in one number.

### 2.2 Hand features

All hand features are relative to the suit `X` of the card on offer in that round. A bidder
cannot hold the turned card (it is in the dealer's hand).

| Feature | Buckets | Why it changes the bid value |
|---|---|---|
| Trump count `t` | 6 (0, 1, 2, 3, 4, 5) | Trump length is pulling power. With 0 trumps the cell is one cell for all other features: nobody bids it. |
| Trump honours `h` | 4 (A, K, Q held: 0 to 3) | Points and control of the trump suit. |
| Boss `b` | 2 (holds the highest trump that is not the turned card) | A boss trump wins a trick whatever the others hold; this is the card that a pull ends with. |
| Side aces `a` | 4 (0 to 3) | Aces win tricks without trump and are 4 points each. |
| Side kings `k` | 3 (0, 1, 2 or more) | A king is 3 points, but a bare king is easy prey. |
| Short side suits `s` | 3 (suits with 0 or 1 card: 0, 1, 2 or more) | A short suit lets the hand buy (trump) early. |
| Alternative suit `alt`, round 1 only | 3 (weak, fair, strong). Take the best of the 3 other suits, each with `n` cards and "top" = it holds the A or K of that suit. Strong: `n` >= 4, or `n` = 3 with top. Fair: `n` = 3, or `n` = 2 with top. Weak: all else | Passing in round 1 buys the second card. A hand that fits another suit waits (`heuristic.ts:694-697`). Without this feature the table cannot learn to wait. |

Not all combinations exist (for example `h` cannot exceed `t`), and not every cell exists with
every `T` (with the trump ace turned, `h` is at most 2). The cells come from an **exact
enumeration**, *measured*: the 6 ranks of the turned card in one suit (the suits are
symmetric) times all C(23,6) = 100,947 hands from the other 23 cards = 605,682 hands (the same
as C(23,6) x 24 turned cards, divided by 4 suits). It runs in a few seconds.

| Set | Count |
|---|---|
| Cells, round 2 (no `alt`) | 260 |
| Cells, round 1 (with `alt`) | 462 |
| Feasible (cell, `T`) pairs, round 2 / round 1 | 910 / 1,617 (of 1,040 / 1,848) |
| Pairs that hold 99% of the deals, round 2 / round 1 | 634 / 1,206 |

The training script must repeat this enumeration (not sample), and take the cell list, the
feasible pairs and the deal weights from it. A test checks the counts above and that the
weights add up to 1. `cfr` reads the lists from the table header.

### 2.3 Turned card feature

| Feature | Buckets | Why |
|---|---|---|
| Turned card `T` (the card of the round) | 4 (A, K, Q or J, 10 or 9) | The card sits in the dealer's hand. A high trump there is a threat when the dealer is an opponent (`p` 0 or 2) and a gain when the dealer is the partner (`p` 1). The heuristic does the same: `turned` in `heuristic.ts:685-688`. |

The dealer's decision has the two turned cards `T1` and `T2` (4 buckets each) and a flag
"same suit" (2). The dealer knows nothing else. Of the 32 ordered pairs, 2 cannot occur with
the same suit (two aces, two kings), so there are 16 pairs of different suits and 14 pairs of
the same suit: 30 slots.

### 2.4 Game-state features

| Feature | Buckets | Why |
|---|---|---|
| Round | 2 | The stake: level 1 is the multiplier, level 2 is always 2 lines. |
| Position `p` | 3 | Who still has to speak, and if the turned card is the partner's. |
| Multiplier `m` | 2 (1, 2) | The level-1 stake in round 1. It is also in the round 2 and dealer sets: an all pass can follow from every node, and option B values it as `W(m=2) - W(m)` (3.4). Under option A (Q1) the all pass is 0, `m` matters in round 1 only, and the round 2 and dealer sets halve. |
| Own lines | 4 (1, 2, 3 to 4, 5 or more) | A win that crosses all lines ends the match; a loss gives the opponent a koei and its lines. Far from the end the exact count stops mattering. `heuristic.ts:681-683` uses the same thresholds (1 and 2). |
| Opponent lines | 4 (1, 2, 3 to 4, 5 or more) | A loss that crosses all opponent lines ends the match (knijpen is pointless at 1 line, `heuristic.ts:679`). |

### 2.5 Size of the abstract game

| Decision | Formula | Information sets |
|---|---|---|
| Round 1 bid | 3 positions x 2 multipliers x 1,617 (cell, `T`) pairs x 16 line pairs | 155,232 |
| Round 2 bid | 3 positions x 2 multipliers x 910 pairs x 16 line pairs | 87,360 |
| Dealer's choice | 30 (`T1`, `T2`, same suit) x 2 multipliers x 16 line pairs | 960 |
| Troefke ask (if taken, Q3) | at most 170 cells x 2 levels, no lines. Only after a bid by position 2 | 340 |
| **Total** | | **243,892** (243,552 without the troefke) |

The 170 cells are the cells with 3 or more trumps, or 2 trumps with an honour of the Q, K or A.
`troefkeHand` needs a K or A for 2 trumps, so this is an upper bound.

Expected: about 177,600 of these hold 99% of the visits (round 1: 1,206 x 16 x 6 = 115,776;
round 2: 634 x 16 x 6 = 60,864; dealer: 960). The rest are rare. They get a back-off
(section 5).

Under option A the round 2 and dealer sets halve: 155,232 + 43,680 + 480 = 199,392.

Why not more? Each factor of 2 doubles the sets, and the visits needed per set stay the same
(section 4). Why not less? The 16 line pairs are the part to cut first if training is sparse:
3 x 3 would give 9 pairs and about 137,000 sets. Q6 asks.

## 3. The value of a leaf (AC3)

### 3.1 The leaves

| Leaf | When | Value |
|---|---|---|
| Contract played | a `bid` with `play: true`, or a `choose` with a suit | see 3.2 |
| All pass | the dealer chooses `null` | see 3.4 |

Chance decides the deal: each iteration draws a full deal, so all four hands and both turned
cards are fixed, and a pass continues along the same deal (round 2 is the same hand against the
second card).

### 3.2 A cached playout per bucket

The value of a contract depends on the whole deal, but not on the line counts (lines only enter
as the cap at 0 and in the match outcome). So the cache stores the **distribution of the hand
result**, not a number of lines:

- The key is `(cell without alt, T, bidder position p)`: 910 feasible pairs x 3 positions =
  2,730 keys for bids, and 46 keys for the dealer (16 `T1` `T2` pairs of different suits x 2
  suit choices, plus 14 pairs of the same suit x 1).
- The position is in the key because the three positions play different hands. Position 0
  leads its own contract. `startPlaying` makes position 0 the first leader whoever bids
  (`engine.ts:309`), so for position 2 the partner leads and a troefke is possible
  (`engine.ts:216-217`), and for position 1 (the dealer's partner) an opponent leads. The
  dealer's contract is led by an opponent too.
- The round is not in the key: a level-1 and a level-2 contract on the same suit play the same
  hand. The stake is applied when the leaf is valued.
- A sample draws a random deal that fits the key (the other 18 cards are dealt at random),
  gives the contract to the bidder, and plays the hand to the end with the card-play
  algorithm in all four seats, including the troefke the bot would ask.
- The sample is stored as one of 5 result classes for the playing team: win, win with kapot,
  draw (20-20), loss, loss with kapot. A loss always carries a koei. The distribution of a key
  is the 5 frequencies.
- The leaf value is then computed from the classes with the stake (multiplier or 2), the kapot
  line, the koei line and the lines of both teams, exactly as `scoreHand` does
  (`engine.ts:353-402`), including the floor at 0 lines.

The card-play algorithm: `pimc` with 3 worlds per decision and 1 partner world, no anchor.
Reason: it plays the cards like the `hard` level at a third of the time. The measurements:

| Card play in all four seats, one hand | ms per hand, *measured* |
|---|---|
| `heuristic:hard` | 2.1 |
| `pimc`, 1 world | 44 to 48 |
| `pimc`, 3 worlds | 102 to 124 (middle 113) |
| `pimc`, `HARD_PIMC` (10 worlds, anchor) | 309 to 315 |
| `pimc`, 20 worlds (default) | 630 to 877 |
| `solve` on one fully known world, the first lead of 6 cards | 15 |

Two runs gave the ranges. 20 deals (seeds 1 to 20 of the engine), the first bidder says "play" on
the first card, one thread. 10, 5 and 20 deals respectively for the `HARD_PIMC`, default and
other rows.

### 3.3 Samples per bucket

| Keys | Samples each | Playouts | Standard error of the win chance |
|---|---|---|---|
| 1,902 bid keys that hold 99% of the deals (634 pairs x 3 positions) | 300 | 570,600 | 0.029 |
| 828 rare bid keys (276 pairs x 3) | 50 | 41,400 | 0.07 |
| 46 dealer keys | 300 | 13,800 | 0.029 |
| **Total** | | **625,800** | |

The break-even win chance of a level-1 bid is 2/3 (`breakEven(1)` in `value.ts`), of a level-2
bid 3/5. A standard error of 0.03 is enough to tell a clear bid from a clear pass, not a bid
within 0.03 of the line. Those borderline cells are where the mixed strategy comes from anyway.

### 3.4 Koei, multiplier, all pass

| Item | Treatment |
|---|---|
| Koei | In the class "loss": the playing team gets +1 line. The cache has the class, the leaf adds the line. |
| Kapot | Two classes (win and loss with kapot), +1 line each, never multiplied (`engine.ts:362`). |
| Multiplier | Not in the cache. The leaf uses the multiplier of the sampled state on level 1, and 2 on level 2. |
| 20-20 | Class "draw": 0 lines now. The next level-1 stake goes to x2 (`engine.ts:401`): handled like the all pass. |
| All pass | The value is the change of the match chances when the multiplier becomes 2 and the deal moves on: `W(own, opp, m=2) - W(own, opp, m)` (see 3.5). With `m` already 2 it is 0. The existing solver counts all pass as plain 0 (`solver.ts:306-311`). That is the fallback. |
| The next deal after an all pass | The thrown-in hands form the next deck, so the next hands are correlated with these. Not modelled. |

### 3.5 What the utility is

Two options. Q1 asks.

- **A. Lines.** The utility is the expected `handValue` in lines (`value.ts`). Risk neutral, and
  simple. The line counts then matter only through the floor at 0. A hand that ends the
  match is worth the same as any other 2 lines, so the table would not learn to take risks near
  the end. The heuristic patches that with `decisive` (`heuristic.ts:683`).
- **B. Match chances (recommended).** The utility is the change of `W(own lines, opponent
  lines, m)`, the chance of the team to win the match. `W` is computed once by dynamic
  programming over the line pairs, with the result classes of a hand taken from the cache
  (averaged over the cells that a bot plays) and from heuristic self-play (how often a hand is
  played, passed all or drawn). It costs one extra script and about 1,000 heuristic self-play
  matches (*estimate*: 24 seconds, at 2 ms per hand and 12 hands per match). The line features
  in the information sets then have a meaning.

### 3.6 The bias of this valuation

| Bias | Direction | Remedy |
|---|---|---|
| **Earlier passes are ignored.** The other three hands are random. In fact a player who passed holds less of the suit. | Position 1, 2 and round 2 value a bid wrong. The sign is not clear: weak defenders help the bidder, a weak partner hurts. | Store each playout with the cells of all four hands. Re-weigh the samples by the pass chances of the current table (importance weights, no new playouts). Do it after the first bench (Q4). |
| **Round 2: the dealer also holds the first turned card `T1`.** `turned.first` is the dealer's 6th card (`engine.ts:284`), and it has the other suit in round 2. The cache sample deals the dealer's cards at random, with no `T1` bucket. | A strong `T1` (a side ace) gives the defenders a trick that the cache does not see. Round 2 bids look slightly too good, more so when the dealer is an opponent. | Named, not fixed in version 1. The stored playouts (Q4) hold the dealer's hand, so the samples can be re-weighed by `T1` later. |
| **Fixed card play, self-play.** All four seats play `pimc` 3 worlds. A real opponent plays another way. | The bid values follow the strength of this algorithm. A weaker defender makes bids look better. | Bench against the `hard` level (section 6). |
| **`pimc` itself.** Strategy fusion (it assumes it learns the hidden cards later). | Small (#87). | None. |
| **Abstraction.** Cells average over hands that differ in play value. | The table cannot tell two hands in a cell apart. | Check the bid rates per cell (section 6). |
| **All pass as 0 or `W` difference.** The next deal is correlated with this one. | Passing looks slightly too good or bad. | Try `V(all pass)` of -0.1, 0, +0.1 lines in a bench. |
| **Few samples in rare cells.** | Noise: random bids in rare cells. | Back-off (section 5). |
| **Double dummy would be worse.** The solver sees all hands: PIMC bids with perfect-information values bid 25% on the 1st card against 7% (#86). | Not used. | The `solve` row above is the 7 times cheaper option, but the bias is known. |

## 4. The MCCFR variant and the run time (AC4)

### 4.1 The variant

**External-sampling MCCFR** (Lanctot et al., 2009) with regret matching and a strategy average
weighted by the iteration number (linear averaging). One iteration:

1. Draw a scenario from a prior: own lines, opponent lines and the multiplier. The prior
   comes from the deal starts of the 1,000 self-play matches of 3.5.
2. Draw a full deal: 24 cards shuffled with the seeded RNG (`src/engine/rng.ts`).
3. For each of the four positions (the three bidders and the dealer) as the traverser: walk
   the game from the first bid. At the traverser's nodes try both bids (the dealer: all
   choices) and update the regrets. At the other nodes draw one action from the current
   strategy. A leaf is a lookup in the cache of section 3.
4. Add the strategies of the visited nodes to the average.

The game has two teams and four players. External sampling has a proof only for two players
with zero sum. Here the two partners act on their own information and have the same payoff,
which is a team game. The average strategy has no proof of a Nash value. We read it as the
strategy that no single seat gains from by changing it, estimated. Risk in section 6.

Both teams use one table: it is written from the point of view of a seat (own lines, opponent
lines), and the same table plays every seat.

### 4.2 The iterations

The unit is the regret update of an information set. Bids are rare (7.9% per node in round 1
and 19.7% in round 2 for `heuristic:hard`, `search-bots.md` section 4; we assume the table
bids about as often), so a pass chain is long. The nodes on it per traversal:

| Nodes | Arithmetic | Expected nodes |
|---|---|---|
| Round 1 | 1 + 0.921 + 0.921^2 | 2.77 |
| Round 2 (reached when 3 pass, 0.921^3 = 0.781, and the 2nd card has another suit, 18/23) | 0.781 x 18/23 = 0.611 reaches it; 0.611 x (1 + 0.803 + 0.803^2) | 1.50 |
| Dealer (after round 2, or after a same-suit 2nd card) | 0.611 x 0.803^3 + 0.781 x 5/23 | 0.49 |
| **Total** | | **4.76** |

One iteration makes 4 traversals (each position once). The traverser of a node updates its
regrets there, so one iteration makes about 4.76 regret updates in total. It also adds to the
strategy average at about 4 x 4.76 = 19 nodes. We count the regret updates, which is the
cautious count.

| Quantity | Value |
|---|---|
| Information sets with 99% of the visits | about 177,600 (section 2.5) |
| Visits wanted per set (mean) | about 3,000 |
| Visits needed | 177,600 x 3,000 = 5.3 x 10^8 |
| Regret updates per iteration | about 4.76 |
| **Iterations** | 5.3 x 10^8 / 4.76 = about **1.1 x 10^8** |

Check on convergence: every 10^7 iterations write the largest change of the strategy over the
sets with 1,000 visits or more. Stop when it falls under 0.01.

### 4.3 The run time

| Step | Arithmetic | Time on one thread | On the Mac |
|---|---|---|---|
| Card-play cache, bids and dealer | 625,800 playouts x 0.113 s (`pimc` 3 worlds, middle of the two *measured* runs) = 70,700 s = 19.6 h | 19.6 h | 70,700 s / 6.8 effective cores = 10,400 s = **2.9 h**. Range: 2.2 h (0.102 s, 8 cores) to 3.2 h (0.124 s, 6.8 cores) |
| Card-play cache, troefke (only if Q3 says yes) | 170 cells x 2 branches x 200 samples = 68,000 playouts x 0.113 s = 7,700 s | 2.1 h | 19 min |
| `W` table (3.5, option B) | 1,000 matches x 12 hands x 2.1 ms | 25 s | 25 s |
| MCCFR loop | 1.1 x 10^8 iterations x 10 to 20 microseconds = 1,100 to 2,200 s | 18 to 37 min | 18 to 37 min (one thread, deterministic) |
| **Total** | | | **about 3.4 h** (range 2.5 to 3.8 h; plus 19 min with the troefke) |

The 6.8 effective cores is an *estimate*: the M2 Pro has 6 fast and 4 slow cores, and a hot
machine slows down. The first run of the measurement was slower than the second (124 against
102 ms), so the machine is not steady.

The 10 to 20 microseconds per iteration is an *estimate*, not measured. One part is
*measured*: drawing a deal and computing one cell of one hand takes 0.97 microsecond (1
million deals, one thread). One iteration draws a deal, computes about 8 cells (4 hands, 1 or 2
suits) and walks about 19 nodes (4 traversals x 4.76), each with a table lookup, a leaf value
from the 5 frequencies and a regret update. The training PR must measure it first with
10^6 iterations, and rescale this table. With `HARD_PIMC` for the card play (309 ms) the cache
costs 2.7 times more: 625,800 x 0.31 s / 6.8 = about 7.9 h on the Mac. Halving the samples per
key halves the cache time.

Determinism: the cache samples have a seed per `(key, sample number)`, so the order of the
workers does not matter. The MCCFR loop is one thread with one seeded RNG. A fixed seed gives
the same table.

The cache is the expensive part and does not change when the MCCFR settings change. So it is
saved as a file and the loop can run again in 18 to 37 minutes.

## 5. The table and the `cfr` algorithm (AC5)

### 5.1 Files

| File | Content | Size (*estimate*) | Shipped |
|---|---|---|---|
| `src/bots/data/bid-strategy.json` | the strategy table | about 0.36 MB | yes, by dynamic import (5.2) |
| `scripts/data/bid-values.json` | the cache of section 3 (2,776 keys x 5 frequencies) | about 0.1 MB | no, only for the training script |
| `scripts/train-bidding.mjs` | cache, `W` table, MCCFR (`npm run train:bidding`) | | no |

The strategy table is a JSON object:

- A header with `version`, the training `seed`, the `iterations`, the bucket borders, the list
  of the 462 cells (their text ids, in order), the lists of the 1,617 and 910 feasible (cell,
  `T`) pairs, and the card-play algorithm of the cache.
- Per context (round 1 by position and multiplier, round 2 by position and multiplier, dealer
  by multiplier, troefke) one string of base64. It holds one byte per information set: the
  chance to go, times 255. The dealer has two bytes per set: the chance of the first suit and
  of the second. The rest is the pass.

Size: 155,232 + 87,360 + 960 x 2 + 340 = 244,852 bytes, base64 about 326 KB, plus a header of
about 35 KB (the cell and pair lists): about 0.36 MB. As a plain number array the same table is
about 0.85 MB. Gzip should bring the base64 under 150 KB (*estimate*).

The table is dense over the feasible pairs (a slot per feasible (cell, `T`) pair, not per
combination of all features): 1,617 pairs against 1,848 (462 x 4) and against 5,184 x 4
combinations of the features.

### 5.2 How `cfr` looks it up

`cfr` is a registered algorithm (`registerAlgorithm`, `algorithm.ts:62`). It follows the
rules of `AGENTS.md`: it gets only the `Observation`, picks only from `obs.legal`, and draws
only from the seeded `rand`.

- `supports(obs)`: true for a `bid` or a `choose` (and a `troefke` if Q3 says yes), false for
  card play. This is the test the issue wants.
- `decide(obs, rand)`:
  1. Context: round from `obs.phase`, position `p = (obs.seat - obs.dealer - 1) mod 4`,
     multiplier from `obs.multiplier`.
  2. Suit `X` and card `T`: the first turned card in round 1, the second in round 2.
  3. Cell: from `obs.hand` and `X` (the dealer has no hand: it uses `T1`, `T2`).
  4. Lines: `obs.lines` from the point of view of `obs.seat` (own, opponent), bucketed.
  5. Read the byte, `p = byte / 255`, then `rand() < p` gives go or pass. Return the legal
     action that matches. If it is not in `obs.legal`, throw: never fall back silently.
- Back-off for a set with fewer than 50 visits: the table stores the strategy of the same
  cell, `T` and context with the most visited line pair. The table is total, so the lookup
  never misses.
- Lazy load and the preload point. `Algorithm.decide` is synchronous, and `LEVEL_BOTS` builds
  its bots at module load (`bot.ts:115-117`), so the factory cannot await a table. The design:
  `cfr.ts` exports `loadBidTable()`, an async function that does the dynamic `import()` of the
  JSON into a module variable (so the start bundle does not grow by 0.36 MB, like the rule for
  `firebase.ts` in `AGENTS.md`). `createCfr` needs no table. `decide` throws "bid table not
  loaded" when the variable is empty: no silent fallback. Who awaits `loadBidTable()` before
  the first decision:
  - The app: `App.svelte`, before it creates the `HostGame` (next to its other dynamic
    imports). `host.ts` itself stays free of it.
  - Bench, probe and `bot:trace`: `loadDecider` in `scripts/bot-spec.mjs` (used by
    `bench-worker.mjs` and `bot-probe.mjs`) awaits it after `ssrLoadModule` when the checkout
    exports it. A side with a git ref that has no `cfr` is not affected. `tune-worker.mjs` is
    to check in the training PR.
  - Tests: `await loadBidTable()` in `beforeAll`.

## 6. How to evaluate (AC6)

### 6.1 Bench plan

The rule of the repo: the win rate plus its margin must reach 50%. Each seed is played twice
with the sides swapped (`bot-benchmark.mjs`).

| # | A | B | Question | Matches |
|---|---|---|---|---|
| 1 | `cfr` bids + `pimc` 10 worlds, no anchor | `heuristic:hard` bids + the same `pimc` | Are the table's bids better, all else equal? | 1,000 (margin about 3.1 points) |
| 2 | `cfr` bids + the `hard` level's `pimc` (`HARD_PIMC`, with anchor) | the `hard` level (`--level hard`) | Does the real level get better? | 1,000, then 5,000 if the result is within the margin of 50% |
| 3 | bid statistics of `cfr` | `heuristic:hard`: 7.9% on the 1st card, 19.7% on the 2nd, 0.0% / 0.7% with 0 / 1 trump (`search-bots.md`, section 4) | Does the table bid in sane places? | self-play of bench 1 |
| 4 | `cfr` + `pimc` | the `hard` level, with the opponents' bids from `heuristic:normal` and `heuristic:easy` | Does it hold against bids that it was not trained on? | 500 each |
| 5 | the cache of section 3 with `HARD_PIMC` cards | the cache with 3 worlds | Does the card-play algorithm of the cache matter? | one table, bench 1 |

Time: a match is about 12 hands (*estimate*) at 0.31 s with the `hard` card play, so about 4
seconds of CPU. A bench of 1,000 matches (2,000 played, both sides) is about 8,000 s of CPU, or
15 minutes with 9 jobs. Bench 1 with 3 worlds is faster.

A gain of 2 points needs a margin under 1 point: about 10,000 matches (margin about 1 point).
That is 2.5 hours with 9 jobs: only run it for a result inside the margin.

Add the results and the choices to `docs/bots/` when the algorithm exists (the rule in
`AGENTS.md`).

### 6.2 Checks that need no bench

- The training script prints the convergence figure of 4.2 and the bid rate per round.
- For the sets with the most visits: print the 20 cells with a bid chance between 0.2 and 0.8.
  A person judges if they are the right borderline hands.
- A seed scan in `tests/bot-scan-bid.test.ts`: with 0 trumps the table never goes.

### 6.3 Risks

| Risk | What it does | What we do |
|---|---|---|
| **The abstraction is too coarse.** Two hands in one cell differ in play value. | The bids lose a few points to the heuristic, which sees the exact hand. | Bench 1. If it fails, split the cell that holds the most losses (e.g. side queens, the ace-less side suits), or add the heuristic `rateHand` score as a feature. |
| **The abstraction is too fine.** 177,600 sets are visited too rarely. | Noisy strategy in the rarer cells. | Back-off to the most visited line pair. Cut the line pairs to 3 x 3. |
| **The valuation is biased** (3.6). | The table is optimal for the wrong game. | The importance weights of Q4. Bench 5 for the card-play algorithm. |
| **Opponents in training are the table itself.** | A real player (a human or the heuristic) bids differently. A balanced strategy is not the best reply to them: it can win less than a tuned best reply. | Bench 4. If it fails, train with one seat set to the heuristic's bids for a second table. |
| **A team game, not zero sum for two.** | No proof of a Nash value. The partners may not coordinate (a pass of the partner is not in the information set beyond the position). | The convergence check, and the bench as the only judge. |
| **`pimc` rate of bids is high.** A search bot bids too often. | Training uses `pimc` only for play. | Not a risk for `cfr`: the table decides the bids. |
| **Match chances `W` is wrong.** | The line features push the bids the wrong way near the end. | Compare with the heuristic `decisive` hands in the scan; fall back to option A. |
| **A bid-only change may not reach the 60% of `expert`.** Bids cost 12 points in the `mcts` comparison (`search-bots.md`, section 4), so they matter, but the upside of a better bid policy is not measured. | #223 needs more than this issue. | Read bench 2 as the upside of bids alone. |

## 7. Open questions for the user (AC7)

| # | Question | Recommended |
|---|---|---|
| Q1 | Utility of a leaf: expected lines (A) or match chances `W` (B)? | **B.** One extra DP script. The line features need it to mean something. |
| Q2 | Card play that values the cache: `pimc` 3 worlds (0.10 s), `HARD_PIMC` (0.31 s) or the solver on one world (15 ms, known to overbid, #86)? | **`pimc` 3 worlds.** About 2.9 h on the Mac (`HARD_PIMC`: 7.9 h). Redo with `HARD_PIMC` only if bench 5 asks. |
| Q3 | Does `cfr` take the troefke ask, or does `pimc` keep it (`pimc.ts:121`)? The issue lists it in scope. The ask is one seat with a fixed obeying partner, not a game, and `pimc` already samples the partner's lead. | **No in the first version.** `supports` covers `bid` and `choose`. The bot rule list is `cfr`, then `pimc`. Add the troefke cells later if a bench says so (+19 min of cache, +340 sets, valid only after a bid by position 2). |
| Q4 | Weigh the samples by the earlier passes in version 1, or after the first bench? | **After the first bench.** Store each playout with the cells of all four hands (about 626,000 x 12 bytes = 7.5 MB, not committed), so the second pass costs no playouts. The same records fix the `T1` bias of round 2 (3.6). |
| Q5 | Value of the all pass: `W(m=2) - W(m)` (needs Q1 = B), or plain 0 as in the solver? | **`W` difference** under B, 0 under A. Test -0.1 and +0.1 lines as a check. |
| Q6 | Size: 243,892 sets (4 x 4 line pairs, `alt` in round 1, `m` everywhere), or smaller (3 x 3 line pairs, about 137,000 sets)? | **243,892.** Cut only if the convergence check fails at 1.1 x 10^8 iterations. |
| Q7 | Table format: base64 bytes (0.36 MB) or a readable number array (0.85 MB)? Commit the cache (0.1 MB)? | **Base64 for the table, and commit both.** The header stays readable. A new table needs the 18 to 37 minute loop, not the 2.9 h cache. |
| Q8 | Is a run of about 3.4 hours (2.5 to 3.8) on the dev Mac acceptable, run by hand and never in CI? | **Yes.** Re-run only when the engine's scoring or the card-play algorithm changes. |
| Q9 | Accept that this issue alone may not make the `expert` level reach 60% against `hard`? | **Yes.** Count bench 2 as the measure of the bids, and judge the rest in #223. |
| Q10 | Table load: `cfr` needs a preloaded table (`loadBidTable()`, 5.2), or a static JSON import (no preload, but +0.36 MB in the start bundle and the solo player downloads it)? | **Preload.** The start bundle stays small, and `decide` fails loudly if the call is missing. |

## 8. Plan after agreement

1. `scripts/train-bidding.mjs`: the abstraction (cell function shared with `cfr` in
   `src/bots/`), the exact cell enumeration (with a test of the counts), the cache, `W`, the MCCFR loop, a determinism test for a fixed seed.
2. `src/bots/cfr.ts` and its tests: `supports` is false for card play, only legal bids, the
   lookup and the back-off.
3. Table and cache in the repo, bench 1 to 5, results in `docs/bots/`.

## Appendix: the measurement

Throwaway scripts outside the repo, not committed. They load the engine and the bots with the
same Vite server that `scripts/bot-probe.mjs` uses.

- Card play: for seeds 1 to 20, play the dealing with `heuristic:hard` until `BIDDING_R1`,
  let the first bidder say "play", and time the hand to `SCORED` with the same bot in all four
  seats. The bot is a rule list: `pimc` with the named options, then `heuristic:hard`. One
  warm-up hand first. Two runs, on an Apple M2 Pro (10 cores), one thread.
- `solve`: the same deals, `trickAcks` full, all six first leads at once.
- Cells: exact enumeration of the 6 turned ranks of one suit times C(23,6) hands = 605,682
  hands. Count the distinct cells and (cell, `T`) pairs of 2.2 and 2.3, and the pairs that hold
  99% of the weight. A first version with 3 million random deals gave the same 260 and 462
  cells. A second script times 1 million random deals at 0.97 microsecond per deal and cell.
