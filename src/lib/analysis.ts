import { writable } from 'svelte/store'
import type { Readable } from 'svelte/store'
import { legalActions, partnerOf } from '../engine'
import type { Action, State } from '../engine'
import { rateDecision } from '../bots/analysis'
import type { Rating } from '../bots/analysis'
import type { ReplayMove } from './kjn'

/** A decision a replay step shows: the state, the seat and what it did. */
interface Decision {
  state: State
  seat: number
  played: Action
}

/**
 * The decisions behind replay step `k`. Mostly the recorded action; the
 * partner's first lead also shows the bidder's choice not to ask a troefke,
 * which the record has no step for (the bidder's acknowledgement).
 */
export function stepDecisions(steps: State[], moves: ReplayMove[], k: number): Decision[] {
  const move = moves[k]
  if (!move) return []
  const out: Decision[] = []
  const { before, action } = move
  const prev = steps[k - 1]
  if (action.type === 'play' && before.bidder !== null && before.tricksPlayed === 0 && before.trick.length === 0) {
    const bidder = before.bidder
    if (action.seat === partnerOf(bidder) && legalActions(prev, bidder).some((a) => a.type === 'troefke')) {
      out.push({ state: prev, seat: bidder, played: { type: 'ack', seat: bidder } })
    }
  }
  out.push({ state: before, seat: action.seat, played: action })
  return out
}

/** FNV-1a of the record: the same match always gets the same ratings. */
export function matchSeed(kjn: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < kjn.length; i++) h = Math.imul(h ^ kjn.charCodeAt(i), 0x01000193)
  return h | 0
}

/** The ratings of replay step `k`: one per real decision, none for a step without a choice. */
export function rateStep(steps: State[], moves: ReplayMove[], k: number, seed: number): Rating[] {
  return stepDecisions(steps, moves, k).flatMap((d, i) => {
    const r = rateDecision(d.state, d.seat, { played: d.played, seed: seed ^ Math.imul(k * 2 + i + 1, 0x9e3779b1) })
    return r ? [r] : []
  })
}

/** Messages of the analysis worker. */
export type AnalysisRequest = { kjn: string } | { step: number }
export interface AnalysisResult {
  step: number
  ratings: Rating[]
}

/** The worker side the `Analyzer` talks to; a fake in tests. */
export interface AnalysisPort {
  postMessage(msg: AnalysisRequest): void
  onmessage: ((e: MessageEvent<AnalysisResult>) => void) | null
  terminate(): void
}

/**
 * Rates replay steps in a worker, one step at a time and the most wanted
 * first, and keeps every result. `want` replaces the wish list, so the step
 * on screen never waits behind steps the viewer left.
 */
export class Analyzer {
  private readonly cache = new Map<number, Rating[]>()
  private readonly store = writable(this.cache)
  private queue: number[] = []
  private busy: number | null = null
  readonly results: Readable<Map<number, Rating[]>> = { subscribe: this.store.subscribe }

  constructor(
    private readonly port: AnalysisPort,
    kjn: string,
  ) {
    port.onmessage = ({ data }) => {
      this.cache.set(data.step, data.ratings)
      this.busy = null
      this.store.set(this.cache)
      this.next()
    }
    port.postMessage({ kjn })
  }

  want(steps: number[]): void {
    this.queue = steps.filter((k) => !this.cache.has(k))
    this.next()
  }

  private next(): void {
    if (this.busy !== null) return
    const k = this.queue.find((s) => !this.cache.has(s))
    if (k === undefined) return
    this.queue = this.queue.filter((s) => s !== k)
    this.busy = k
    this.port.postMessage({ step: k })
  }

  stop(): void {
    this.port.terminate()
  }
}
