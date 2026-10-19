# Defender pull: a low trump only with two side aces

Issue: #195 (2026-10-15). Question: why do bot defenders open with a low trump against the
bidders, who very likely hold more trumps, and is that a good lead?

## The rule

`leadCard` in `src/bots/heuristic.ts`: a defender with no more trumps than the other three
players hold together, its partner included (`shortDefender`), and a side ace leads its lowest
trump, so that the bidders' trumps fall before its aces go (#153). Trump is always allowed, so a
side ace is not safe while a bidder holds trump.

The cost: on a trump lead the defender's partner must also play a trump, the bidders keep the
majority, and they usually win the trick and the lead.

## Data from real matches

51 KJN records (`games/` in Firestore, 2026-10-14). Defender leads that were not forced:

| Leader | Leads | Trump leads | Bidders won that trick |
|---|---|---|---|
| `bot-hard`, builds before #153 | 483 | 35 (7%) | 16 |
| `bot-hard`, builds with the rule | 423 | 63 (15%) | 39 (62%) |
| humans | 458 | 61 (13%) | 35 (57%) |

Of the 63 trump leads of the new builds, 50 came from a leader with fewer trumps than the
bidders' team. The leader held one side ace in 33, two in 11 and none in 19.

## Measurements

Variants of the rule, `heuristic:hard` against `develop`'s `heuristic:hard`:

| Variant | Match bench, 2000 seeds | Per hand, 25,382 hands | Defender trump leads per hand |
|---|---|---|---|
| `develop` | — | — | 0.333 |
| no defender pull | 48.2% ± 1.5% (fails the bench rule) | −0.026 ± 0.014 lines | 0.115 |
| **two or more side aces (chosen)** | **49.3% ± 1.5%** | **−0.006 ± 0.013 lines** | **0.155** |

The per-hand bench plays each hand of 2000 `develop` self-play matches again from the end of the
bidding, once per variant. The bidders always play `develop`, so only the defenders' cards differ,
and the deal luck cancels out. Value: the lines the defenders cross minus the lines the bidders
cross (`handValue`), ± the 95% interval of the paired difference.

The pull with one side ace is most of the trump leads, and without it the defenders lose nothing
measurable. Without the pull with two or more side aces as well, the bot fails the bench rule, so
that pull stays. The gap between the two variants (about 0.02 lines per hand) is not significant
on its own: both were measured against `develop`, not against each other. Most changed hands
swing by 5 lines: the lead decides whether the contract is made or lost with a koei.

With the chosen variant:

| Bench | Result |
|---|---|
| `hard` level bot vs `develop` (200 seeds) | 51.0% ± 4.9% |
| `hard` level bot vs `heuristic:normal` (200 seeds, target ≥ 75%) | 84.8% ± 3.5% |
| `heuristic:normal` vs `heuristic:easy` (1000 seeds, target ≥ 75%) | 79.2% ± 1.8% |

Not changed: the pimc worlds of the `hard` level do not use the bid, so a bidder holds an average
number of trumps there, and pimc can still choose a trump lead on its own (#90).
