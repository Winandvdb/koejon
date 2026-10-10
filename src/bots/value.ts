/**
 * Value of a hand for `team`: lines it crossed minus lines the other team
 * crossed, from the line counts before and after the engine scored it. So it
 * counts stake, multiplier, kapot and koei (+1 line for the bidding team)
 * exactly as `src/engine/` does, including the floor at 0 lines. Zero-sum:
 * the other team gets the negative. All search algorithms score hands with it.
 */
export function handValue(
  before: { lines: [number, number] },
  after: { lines: [number, number] },
  team: number,
): number {
  const crossed = (t: number) => before.lines[t] - after.lines[t]
  return crossed(team) - crossed(1 - team)
}

/**
 * Win chance a bid at `stake` lines needs to break even: a win crosses the
 * stake, a loss gives the stake away plus a koei.
 */
export const breakEven = (stake: number) => (stake + 1) / (2 * stake + 1)
