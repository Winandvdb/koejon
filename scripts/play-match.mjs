// One full bot match on the engine, shared by the bot benchmark and the
// heuristic tuner. The engine modules come from the caller's vite server.

const STEP_CAP = 20000

/**
 * @typedef {{
 *   apply: Function, createMatch: Function, pendingSeats: Function,
 *   seededRandom: (seed: number) => () => number,
 * }} MatchEngine
 */

/**
 * Play the match of `seed`; `pair[team]` decides for that team. With `stats`
 * (see newBidStats in bench-worker.mjs), count the bids. Returns the winning team.
 * @param {MatchEngine} engine
 * @param {number} seed
 * @param {Function[]} pair
 * @param {ReturnType<typeof import('./bench-worker.mjs').newBidStats>} [stats]
 */
export function playMatch(engine, seed, pair, stats) {
  const { apply, createMatch, pendingSeats, seededRandom } = engine
  let s = createMatch(seed)
  const rand = seededRandom(seed * 7919 + 13)
  let steps = 0
  while (s.phase !== 'GAME_OVER') {
    if (steps++ > STEP_CAP) throw new Error(`match ${seed} did not terminate`)
    const seat = pendingSeats(s)[0]
    const a = pair[seat % 2](s, seat, rand)
    if (stats && a.type === 'bid') {
      const r1 = s.phase === 'BIDDING_R1'
      const suit = r1 ? s.turned.first.s : s.turned.second.s
      stats[r1 ? 'r1' : 'r2'][0]++
      if (a.play) {
        stats[r1 ? 'r1' : 'r2'][1]++
        stats.trumps[s.hands[seat].filter((/** @type {{ s: string }} */ c) => c.s === suit).length]++
      }
    }
    const next = apply(s, a)
    if (stats && s.phase === 'DEALING') stats.hands++
    if (stats && !s.turned?.secondUp && next.turned?.secondUp) stats.secondUp++
    s = next
  }
  return s.winner
}
