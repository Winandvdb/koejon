// Web Worker of the replay analysis: the ratings take up to seconds per step,
// so they never run on the page's thread. No network: the match comes in as text.
import { matchSeed, rateStep } from './analysis'
import type { AnalysisRequest, AnalysisResult } from './analysis'
import { parseKjn, replayMoves } from './kjn'
import type { ReplayMove } from './kjn'
import type { State } from '../engine'

let steps: State[] = []
let moves: ReplayMove[] = []
let seed = 0

self.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
  if ('kjn' in data) {
    const match = parseKjn(data.kjn)
    ;({ steps, moves } = replayMoves(match))
    seed = matchSeed(match)
    return
  }
  const result: AnalysisResult = { step: data.step, ratings: rateStep(steps, moves, data.step, seed) }
  self.postMessage(result)
}
