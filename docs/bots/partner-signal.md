# Partner signal: a low card under the top card

Issue: #156 (2026-10-18). Question: does the heuristic bot gain when it signals the highest card
left in a suit to its partner, and reads that signal?

## The rule

`src/bots/heuristic.ts`, levels with `tactics` (give) and with memory (read); `easy` does neither.

- **Give** (`followCard`): on a trick that the partner wins, when the bot must discard, it throws a
  card without points (9 or 10) of a side suit where it holds the ace, or the king once the ace
  fell (`acesGone`, `full` memory only). The signal replaces only a card without points: when the
  bot feeds points (vet), it still does.
- **Read** (`readHand`, `signals`): a discard of the partner on a trick that the bot won, where
  the bot played before the partner, a card without points or an ace, says that the partner
  holds the ace of that suit, or the king once the ace fell (also when the discard is the ace). The
  signal ends when that card falls or the partner shows out of the suit, and means nothing when
  the bot holds the card.
- **Lead** (`leadCard`): once no opponent may hold trump, after its own aces and a suit nobody
  else holds, the bot leads its lowest card of the signalled suit. Also in a sweep.

## Measurements

1000 matches each, against `develop` at `e246eaf`:

| Variant | `heuristic:hard` | `--level normal` | `--level hard` |
|---|---|---|---|
| both parts off (check) | 50.0% ± 3.1% | — | — |
| give any low card, read any discard (the first version) | 47.1% ± 3.1% | 47.4% ± 3.1% | — |
| first version, give off | 48.7% ± 3.1% | — | — |
| first version, read off | 48.1% ± 3.1% | — | — |
| give: no vet when the bot has points to feed elsewhere | 49.6% ± 3.1% | — | — |
| give only instead of a card without points, read 9, 10 and aces | 50.0% ± 3.1% | 50.2% ± 3.1% | 48.9% ± 3.1% |
| **same, and read only an ace or king, only when the bot played before the partner, not after the partner showed out (chosen)** | **50.7% ± 3.1%** | **50.2% ± 3.1%** | **48.9% ± 3.1%** |

The first version gave the signal instead of a vet, so the team lost the points of a queen or a
jack, and it read every discard as a signal, also a vet with a queen. The chosen version costs no
points and reads no vet; it passes the bench rule at all three, but gains nothing measurable.
