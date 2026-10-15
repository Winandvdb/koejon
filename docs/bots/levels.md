# Bot levels: the gaps between easy, normal and hard

Issue: #161 (2026-10-11). Question: how much stronger must each level be than the level
below it, and what makes `easy` a beginner?

## Targets

Agreed with the user. Each target holds with the ± margin of `npm run bench` (95% interval).

| Gap | Target | Bench |
|---|---|---|
| `hard` level bot vs `heuristic:normal` | at least 75% | `npm run bench -- --level hard --b heuristic:normal --matches 200` |
| `heuristic:normal` vs `heuristic:easy` | at least 75% | `npm run bench -- --a heuristic:normal --b heuristic:easy --matches 1000` |

A bot change that moves a level must keep both targets.

## What easy lacks

`BOT_PROFILES` in `src/bots/heuristic.ts`:

- `tactics: false`: no knijpen, no troefke, no weighing of the dealer's choice, and no lead
  tactics. Easy cashes an ace at once, also when an opponent may trump it. It does no length
  pull, no low trump to draw the trump ace, no defender pull (`defender-pull.md`) and no
  draw-out of an ace under its king. It keeps the pull with the boss trump.
- `lazy: 'random'`: the lazy move (45% of card decisions) plays any legal card. The other
  levels play the cheapest dump.
- `memory: 'none'` and the bid constants of `LEVEL_OPTIONS.easy`, as before.

## Measurements

`heuristic:normal` vs `heuristic:easy`, seats swapped.

| easy variant | Seeds | normal wins |
|---|---|---|
| `develop` before #161 | 1000 | 66.8% ± 2.1% |
| without the lead tactics | 1000 | 68.1% ± 2.0% |
| + skill 0.25 (more lazy dumps) | 300 | 72.2% ± 3.6% |
| + no partner trust (#152), skill 0.4 | 300 | 73.7% ± 3.5% |
| without the lead tactics, bids 17/14/13 | 300 | 66.5% ± 3.8% |
| **without the lead tactics, random lazy card (chosen)** | 1000 | **80.2% ± 1.7%** |

The cheapest dump is a good move, so more lazy dumps hardly weaken easy. Only a random card
does: it gives aces and points away, as a beginner does.

`hard` level bot vs `heuristic:normal` on the same branch: 84.3% ± 3.6% (200 seeds). #161
does not change `normal` or `hard`: both score exactly 50.0% against `develop`.
