// Worker of the heuristic tuner: boots one vite server, then scores
// candidates until the tuner sends `{ close: true }`. A task is
// `{ id, options, seeds }`; each seed is played twice with the sides swapped,
// `heuristic:hard` with `options` against this checkout's `heuristic:hard`.
// With `workerData.play` 'pimc' both sides play their cards and the troefke
// with pimc (`HARD_PIMC`, `workerData.samples` worlds when set), see tuneBot.
// Replies `{ id, wins, n }`. `{ id, defaults: true }` replies with the options
// that this checkout's heuristic:hard plays and the pimc options of the
// `hard` level (`levelPimc`).
import { resolve } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { createServer } from 'vite'
import { playMatch } from './play-match.mjs'
import { tuneBot } from './tune-spsa.mjs'

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort)

/** @typedef {{ id: number, options: Record<string, number>, seeds: number[], defaults?: boolean, close?: boolean }} TuneTask */

try {
  const server = await createServer({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
  })
  const { apply, createMatch, pendingSeats } = await server.ssrLoadModule('/src/engine/index.ts')
  const { seededRandom } = await server.ssrLoadModule('/src/lib/seed.ts')
  const { createBot, HARD_PIMC } = await server.ssrLoadModule('/src/bots/bot.ts')
  const { levelOptions } = await server.ssrLoadModule('/src/bots/heuristic.ts')
  const engine = { apply, createMatch, pendingSeats, seededRandom }
  const pimc =
    workerData?.play === 'pimc' ? { ...HARD_PIMC, ...(workerData.samples ? { samples: workerData.samples } : {}) } : null
  const base = createBot(tuneBot({}, pimc))

  port.on('message', async (/** @type {TuneTask} */ task) => {
    try {
      if (task.close) {
        // Close the server first: a terminate leaves its handles behind.
        await server.close()
        port.close()
        return
      }
      if (task.defaults) {
        port.postMessage({ id: task.id, defaults: levelOptions('hard'), levelPimc: HARD_PIMC })
        return
      }
      const cand = createBot(tuneBot(task.options, pimc))
      let wins = 0
      for (const seed of task.seeds) {
        if (playMatch(engine, seed, [cand.decide, base.decide]) === 0) wins++
        if (playMatch(engine, seed, [base.decide, cand.decide]) === 1) wins++
      }
      port.postMessage({ id: task.id, wins, n: task.seeds.length * 2 })
    } catch (e) {
      port.postMessage({ id: task.id, error: String(e instanceof Error ? (e.stack ?? e.message) : e) })
    }
  })
} catch (e) {
  // A boot failure must reach the tuner: an exit code alone hides the cause.
  port.postMessage({ id: -1, error: String(e instanceof Error ? (e.stack ?? e.message) : e) })
}
