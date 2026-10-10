import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats } from '../src/engine'
import type { BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { decisionPhase, observe } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { loadDecider, parseSpecArg, realDecisionPhase } from '../scripts/bot-spec.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bot-spec-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('parseSpecArg', () => {
  const config = { name: 'mix', rules: [{ use: 'heuristic:hard' }] }
  // A file name with '@' must not be split into a ref.
  const file = join(dir, 'my@bot.json')
  writeFileSync(file, JSON.stringify(config))

  it('reads an id, with or without a ref', () => {
    expect(parseSpecArg('heuristic:hard')).toEqual({ ref: null, spec: 'heuristic:hard' })
    expect(parseSpecArg('origin/develop@heuristic:easy')).toEqual({ ref: 'origin/develop', spec: 'heuristic:easy' })
  })

  it('reads inline JSON, with or without a ref', () => {
    const spec = { id: 'pimc', iterations: 500 }
    expect(parseSpecArg(JSON.stringify(spec))).toEqual({ ref: null, spec })
    expect(parseSpecArg(`origin/develop@${JSON.stringify(spec)}`)).toEqual({ ref: 'origin/develop', spec })
  })

  it('reads a configuration file, with or without a ref', () => {
    expect(parseSpecArg(file)).toEqual({ ref: null, spec: config })
    expect(parseSpecArg(`5b12811@${file}`)).toEqual({ ref: '5b12811', spec: config })
  })

  it('names the file when a .json file is missing', () => {
    expect(() => parseSpecArg(join(dir, 'missing.json'))).toThrow(/cannot read bot spec file/)
  })
})

describe('realDecisionPhase', () => {
  it('marks exactly the decisions that createBot does not fix', () => {
    const bot = createBot('heuristic:normal')
    for (const seed of [1, 2, 3]) {
      let s = createMatch(seed)
      const rand = seededRandom(seed * 7919 + 13)
      while (s.phase !== 'GAME_OVER') {
        const seat = pendingSeats(s)[0]
        const legal = legalActions(s, seat)
        const trace: BotTrace = { candidates: [], notes: [] }
        const a = bot.decide(s, seat, rand, trace)
        // The bot sets the algorithm only for a real decision.
        expect(realDecisionPhase(legal)).toBe(trace.algorithm ? decisionPhase(observe(s, seat)) : null)
        s = apply(s, a)
      }
    }
  })
})

describe('loadDecider', () => {
  const calls: string[] = []
  const mod = {
    createBot: (spec: unknown) => ({ name: String(spec), decide: () => calls.push(`createBot ${spec}`) }),
    botAction: (_s: unknown, _seat: number, _rand: unknown, level: string) => calls.push(`botAction ${level}`),
  }
  const server = { ssrLoadModule: async () => mod } as unknown as Parameters<typeof loadDecider>[0]

  it('plays botAction without a spec, also when the checkout has createBot', async () => {
    calls.length = 0
    const d = await loadDecider(server, null, null, 'hard')
    d.decide({}, 0, Math.random)
    expect(calls).toEqual(['botAction hard'])
    expect(d).toMatchObject({ name: 'botAction:hard', legacy: false })
  })

  it('builds a spec with createBot', async () => {
    calls.length = 0
    const d = await loadDecider(server, null, 'heuristic:easy', 'hard')
    d.decide({}, 0, Math.random)
    expect(calls).toEqual(['createBot heuristic:easy'])
    expect(d.legacy).toBe(false)
  })

  it('marks a spec on a checkout without createBot as legacy', async () => {
    const old = { ssrLoadModule: async () => ({ botAction: mod.botAction }) } as unknown as typeof server
    expect(await loadDecider(old, '/old', 'heuristic:easy', 'normal')).toMatchObject({
      name: 'botAction:normal',
      legacy: true,
    })
  })
})
