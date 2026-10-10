import type { Action } from '../engine'
import { createHeuristic } from './heuristic'
import type { Observation } from './observation'

/** One candidate an algorithm weighed, for debugging and tuning. */
export interface TraceCandidate {
  action: Action
  score?: number
  visits?: number
  note?: string
}

/** Optional record of how a decision was made. Algorithms fill it; the bot adds the rule. */
export interface BotTrace {
  candidates: TraceCandidate[]
  notes: string[]
  /** Index of the bot rule that decided. */
  rule?: number
  /** Id of the algorithm that decided. */
  algorithm?: string
}

/** A building block that makes one kind of decision from an observation. */
export interface Algorithm {
  id: string
  /** False when this algorithm cannot make this decision (for example card play only). */
  supports(obs: Observation): boolean
  decide(obs: Observation, rand: () => number, trace?: BotTrace): Action
}

/**
 * An algorithm id (`'heuristic:normal'`: name, then an optional variant after
 * the colon), or an object with that id plus options. JSON-compatible, so bot
 * configurations can live in files.
 */
export type AlgorithmSpec = string | ({ id: string } & Record<string, unknown>)

/**
 * Builds an algorithm. `create` builds the algorithms that its options name
 * (a playout policy, an opponent model), so no algorithm imports another.
 */
export type AlgorithmFactory = (
  variant: string | undefined,
  options: Record<string, unknown>,
  create: (spec: AlgorithmSpec) => Algorithm,
) => Algorithm

const ALGORITHMS = new Map<string, AlgorithmFactory>([['heuristic', createHeuristic]])

/** Add an algorithm under `name`. A name can be taken only once. */
export function registerAlgorithm(name: string, factory: AlgorithmFactory): void {
  if (ALGORITHMS.has(name)) throw new Error(`algorithm already registered: ${name}`)
  ALGORITHMS.set(name, factory)
}

export function createAlgorithm(spec: AlgorithmSpec): Algorithm {
  const { id, ...options } = typeof spec === 'string' ? { id: spec } : spec
  const colon = id.indexOf(':')
  const name = colon < 0 ? id : id.slice(0, colon)
  const variant = colon < 0 ? undefined : id.slice(colon + 1)
  const factory = ALGORITHMS.get(name)
  if (!factory) throw new Error(`unknown algorithm: ${id}`)
  return factory(variant, options, createAlgorithm)
}
