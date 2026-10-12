// Predictability probe (#178, #183): how often a bot's card differs from the
// card of a reference bot, and from its own card with other random worlds.
//
//   node scripts/bot-probe.mjs [--bot bots/mine.json] [--ref heuristic:hard] [--seeds 8]
//
// Plays seeds 1..--seeds with --bot in all four seats (default: the `hard`
// level, botAction). At each real card choice (more than one legal card) it
// also asks --ref, and --bot again with another random stream. Both extra
// asks draw from their own streams, so the match is the one `npm run bench`
// self-play plays for that seed (`playMatch`). Output is the same for the same
// arguments.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'
import { loadDecider, parseSpec } from './bot-spec.mjs'
import { playMatch } from './play-match.mjs'

const { values: opt } = parseArgs({
  options: {
    bot: { type: 'string' },
    ref: { type: 'string', default: 'heuristic:hard' },
    seeds: { type: 'string', default: '8' },
  },
})
const SEEDS = Number(opt.seeds)
if (!Number.isInteger(SEEDS) || SEEDS < 1) throw new Error(`--seeds must be a positive integer, got '${opt.seeds}'`)

const server = await createServer({
  root: resolve(import.meta.dirname, '..'),
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
})
try {
  const { apply, createMatch, pendingSeats, legalActions } = await server.ssrLoadModule('/src/engine/index.ts')
  const { seededRandom } = await server.ssrLoadModule('/src/lib/seed.ts')
  const bot = await loadDecider(server, null, opt.bot == null ? null : parseSpec(opt.bot), 'hard')
  const ref = await loadDecider(server, null, parseSpec(opt.ref), 'hard')
  const same = (/** @type {any} */ a, /** @type {any} */ b) => a.card.s === b.card.s && a.card.r === b.card.r

  let choices = 0
  let ms = 0
  let otherThanRef = 0
  let otherWorlds = 0
  for (let seed = 1; seed <= SEEDS; seed++) {
    const refRand = seededRandom(seed * 7919 + 101)
    const againRand = seededRandom(seed * 7919 + 202)
    const decide = (/** @type {any} */ s, /** @type {number} */ seat, /** @type {() => number} */ rand) => {
      const t0 = performance.now()
      const a = bot.decide(s, seat, rand)
      const dt = performance.now() - t0
      if (a.type === 'play' && legalActions(s, seat).length > 1) {
        choices++
        ms += dt
        if (!same(a, ref.decide(s, seat, refRand))) otherThanRef++
        if (!same(a, bot.decide(s, seat, againRand))) otherWorlds++
      }
      return a
    }
    playMatch({ apply, createMatch, pendingSeats, seededRandom }, seed, [decide, decide])
  }
  const pct = (/** @type {number} */ k) => `${((100 * k) / choices).toFixed(1)}%`
  console.log(`Bot ${bot.name}, reference ${ref.name}, seeds 1-${SEEDS}`)
  console.log(`Real card choices: ${choices}, ${(ms / choices).toFixed(1)} ms per choice`)
  console.log(`Another card than the reference: ${pct(otherThanRef)}`)
  console.log(`Another card with other random worlds: ${pct(otherWorlds)}`)
} finally {
  await server.close()
}
