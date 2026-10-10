import type { Action, State } from '../engine'
import { createAlgorithm } from './algorithm'
import type { AlgorithmSpec, BotTrace } from './algorithm'
import { BOT_LEVELS } from './heuristic'
import type { BotLevel } from './heuristic'
import { decisionPhase, observe } from './observation'
import type { DecisionPhase, Observation } from './observation'

export { BOT_LEVELS, BOT_PROFILES, TROEFKE_CHANCE } from './heuristic'
export type { BotLevel, BotProfile } from './heuristic'

/** One bot rule: when `when` matches and the algorithm supports the decision, it decides. */
export interface BotRule {
  when?: { phase?: DecisionPhase }
  use: AlgorithmSpec
}

/** A bot as data: the first matching rule decides. JSON-compatible. */
export interface BotConfig {
  name: string
  rules: BotRule[]
}

export interface Bot {
  name: string
  decide(state: State, seat: number, rand: () => number, trace?: BotTrace): Action
}

const partnerOf = (seat: number) => (seat + 2) % 4

/**
 * Steps without a real choice, the same for every bot: lifts, the first
 * dealer, and anything with one legal action (start, deal, next, a lone ack
 * or card). Null for a real decision.
 */
function fixedStep(obs: Observation, rand: () => number): Action | null {
  const { legal, seat } = obs
  const first = legal[0]
  switch (first.type) {
    case 'draw':
    case 'cut':
      // Any packet size in the allowed range, as a real hand would.
      return legal[Math.floor(rand() * legal.length)]
    case 'chooseDealer':
      // Pick a random member of the winner's own team.
      return { type: 'chooseDealer', seat, dealer: rand() < 0.5 ? seat : partnerOf(seat) }
    case 'troefke':
      // Troefke is first only for a bidder that already confirmed. The host
      // and the simulation only ask pending seats, and then the partner is
      // pending, not the bidder. The real decision is in the 'ack' branch.
      throw new Error(
        `bot seat ${seat} was asked to act with only troefke open: only pending seats may be asked, and a bidder decides troefke with its ack`,
      )
  }
  return legal.length === 1 ? first : null
}

/** Build a bot from a configuration, or a pure bot from one algorithm spec. */
export function createBot(config: BotConfig | AlgorithmSpec): Bot {
  // A spec always has an id, a configuration never: an option named `rules` stays an option.
  const cfg: BotConfig =
    typeof config === 'object' && !('id' in config)
      ? config
      : { name: typeof config === 'string' ? config : config.id, rules: [{ use: config }] }
  const algorithms = cfg.rules.map((r) => createAlgorithm(r.use))
  return {
    name: cfg.name,
    decide(state, seat, rand, trace) {
      const obs = observe(state, seat)
      if (obs.legal.length === 0) throw new Error(`bot seat ${seat} has no legal action in ${state.phase}`)
      const fixed = fixedStep(obs, rand)
      if (fixed) return fixed
      const phase = decisionPhase(obs)
      for (let i = 0; i < cfg.rules.length; i++) {
        const when = cfg.rules[i].when
        if (when?.phase && when.phase !== phase) continue
        if (!algorithms[i].supports(obs)) continue
        if (trace) {
          trace.rule = i
          trace.algorithm = algorithms[i].id
        }
        return algorithms[i].decide(obs, rand, trace)
      }
      // Never fall back silently to another algorithm.
      throw new Error(`bot ${cfg.name}: no rule decides ${phase} for seat ${seat} in ${state.phase}`)
    },
  }
}

const LEVEL_BOTS = Object.fromEntries(
  BOT_LEVELS.map((level) => [level, createBot(`heuristic:${level}`)]),
) as Record<BotLevel, Bot>

/**
 * Pick an engine action for a bot seat with the heuristic of `level`. Uses
 * only legalActions, so the no-underbuy and follow rules are always respected.
 */
export function botAction(
  s: State,
  seat: number,
  rand: () => number = Math.random,
  level: BotLevel = 'normal',
): Action {
  return LEVEL_BOTS[level].decide(s, seat, rand)
}
