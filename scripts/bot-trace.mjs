// Bot trace: play one seeded match and show why a bot chose each action.
//
//   npm run bot:trace -- --seed 5
//   npm run bot:trace -- --seed 5 --bot heuristic:hard --seats 0 --hand 2
//   npm run bot:trace -- --seed 5 --bot bots/mine.json --others heuristic:easy --json
//
// --bot is an algorithm id, inline JSON or a bot configuration file (see
// scripts/bot-spec.mjs). It plays the --seats (default 0,1,2,3, or 0,2 with
// --others) and only those seats print; the other seats play --others (default
// --bot). The match is the one `npm run bench` plays for that seed with
// the bots in the same seats. Output is the same for the same arguments.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'
import { loadDecider, parseSpec } from './bot-spec.mjs'
import { decisionJson, formatEvent, traceMatch } from './bot-trace-core.mjs'

const { values: opt } = parseArgs({
  options: {
    bot: { type: 'string', default: 'heuristic:normal' },
    seed: { type: 'string' },
    seats: { type: 'string' },
    others: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    hand: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
})

/** @param {string} name @param {string | undefined} text */
function intOpt(name, text) {
  if (text === undefined) return undefined
  if (!/^\d+$/.test(text)) throw new Error(`--${name} must be a non-negative integer, got '${text}'`)
  return Number(text)
}

const seed = intOpt('seed', opt.seed)
if (seed === undefined) throw new Error('--seed <n> is required')
const from = intOpt('from', opt.from)
const to = intOpt('to', opt.to)
const hand = intOpt('hand', opt.hand)
const seats = opt.seats
  ? opt.seats.split(',').map((t) => {
      const n = Number(t)
      if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error(`--seats must list seats 0-3, got '${opt.seats}'`)
      return n
    })
  : opt.others != null
    ? [0, 2]
    : [0, 1, 2, 3]

// ANSI colour only on a terminal, and never when NO_COLOR is set.
const colour = process.stdout.isTTY && !('NO_COLOR' in process.env)
const CODES = { red: '31', bold: '1' }
/** @type {import('./bot-trace-core.mjs').Paint} */
const paint = colour ? (style, text) => `\x1b[${CODES[style]}m${text}\x1b[0m` : (_style, text) => text

const server = await createServer({
  root: resolve(import.meta.dirname, '..'),
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
})
try {
  const eng = await server.ssrLoadModule('/src/engine/index.ts')
  const { seededRandom } = await server.ssrLoadModule('/src/lib/seed.ts')
  const { observe } = await server.ssrLoadModule('/src/bots/observation.ts')
  const engine = {
    apply: eng.apply,
    createMatch: eng.createMatch,
    pendingSeats: eng.pendingSeats,
    trickWinnerIndex: eng.trickWinnerIndex,
    trickPoints: eng.trickPoints,
    observe,
    seededRandom,
  }
  const main = await loadDecider(server, null, parseSpec(opt.bot), 'normal')
  const others = opt.others == null ? main : await loadDecider(server, null, parseSpec(opt.others), 'normal')
  const bots = [0, 1, 2, 3].map((seat) => (seats.includes(seat) ? main : others))

  let printed = false
  traceMatch(engine, seed, bots, { show: seats, from, to, hand }, (e) => {
    if (opt.json) {
      if (e.type === 'decision') console.log(decisionJson(e.decision))
      return
    }
    // A blank line before each decision, summaries stick to the play above.
    if (e.type === 'decision' && printed) console.log('')
    console.log(formatEvent(e, paint))
    printed = true
  })
} finally {
  await server.close()
}
