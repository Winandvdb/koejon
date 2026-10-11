import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { apply, createMatch, pendingSeats, trickPoints, trickWinnerIndex } from '../src/engine'
import { createBot } from '../src/bots/bot'
import { observe } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { actionText, decisionJson, formatEvent, traceMatch } from '../scripts/bot-trace-core.mjs'
import type { Decision, TraceEvent } from '../scripts/bot-trace-core.mjs'

const engine = { apply, createMatch, pendingSeats, observe, trickWinnerIndex, trickPoints, seededRandom }
const bot = createBot('heuristic:normal')
const normal = { name: bot.name, decide: bot.decide }
const everyone = [normal, normal, normal, normal]
const SEATS = [0, 1, 2, 3]

function events(seed: number, opt: Partial<Parameters<typeof traceMatch>[3]> = {}, bots = everyone): TraceEvent[] {
  const out: TraceEvent[] = []
  traceMatch(engine, seed, bots, { show: SEATS, ...opt }, (e) => out.push(e))
  return out
}
const decisions = (es: TraceEvent[]): Decision[] => es.flatMap((e) => (e.type === 'decision' ? [e.decision] : []))
const at = (e: TraceEvent) => (e.type === 'decision' ? e.decision : e)

describe('traceMatch', () => {
  it('shows every real decision with its rule, algorithm and a legal chosen action', () => {
    const ds = decisions(events(5))
    expect(ds.some((d) => d.kind === 'bidding')).toBe(true)
    expect(ds.some((d) => d.kind === 'play')).toBe(true)
    for (const d of ds) {
      expect(d.rule).toBe(0)
      expect(d.algorithm).toBe('heuristic:normal')
      expect(d.obs.legal.map((a) => actionText(a))).toContain(actionText(d.chosen))
      expect(d.obs.legal.length).toBeGreaterThan(1)
    }
    const steps = ds.map((d) => d.step)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
  })

  it('summarises every trick and every hand of the match', () => {
    const es = events(5)
    const hands = es.filter((e) => e.type === 'hand')
    const tricks = es.filter((e) => e.type === 'trick')
    expect(hands.length).toBeGreaterThan(0)
    expect(tricks.length).toBe(hands.length * 6)
    expect(hands.at(-1)).toMatchObject({ over: true })
  })

  it('plays the same match for the same seed and options', () => {
    expect(JSON.stringify(events(7))).toBe(JSON.stringify(events(7)))
    expect(JSON.stringify(events(7))).not.toBe(JSON.stringify(events(8)))
  })

  it('shows only the chosen seats, but all seats still play', () => {
    const all = events(5)
    const some = events(5, { show: [1, 3] })
    expect(decisions(some).every((d) => d.seat === 1 || d.seat === 3)).toBe(true)
    expect(decisions(some).length).toBe(decisions(all).filter((d) => d.seat % 2 === 1).length)
    // Same match underneath: the summaries do not change.
    expect(some.filter((e) => e.type !== 'decision')).toEqual(all.filter((e) => e.type !== 'decision'))
  })

  it('cuts the output to --from/--to', () => {
    const all = events(5)
    const part = events(5, { from: 30, to: 80 })
    expect(part.length).toBeGreaterThan(0)
    expect(part.every((e) => at(e).step >= 30 && at(e).step <= 80)).toBe(true)
    expect(part).toEqual(all.filter((e) => at(e).step >= 30 && at(e).step <= 80))
  })

  it('cuts the output to one hand', () => {
    const part = events(5, { hand: 2 })
    expect(part.filter((e) => e.type === 'trick').length).toBe(6)
    expect(part.every((e) => at(e).hand === 2)).toBe(true)
  })

  it('lets --others decide for the seats that are not shown', () => {
    const easy = createBot('heuristic:easy')
    const mixed = [normal, { name: easy.name, decide: easy.decide }, normal, { name: easy.name, decide: easy.decide }]
    const es = events(5, { show: [1] }, mixed)
    expect(decisions(es).length).toBeGreaterThan(0)
    expect(decisions(es).every((d) => d.algorithm === 'heuristic:easy')).toBe(true)
    expect(JSON.stringify(es)).not.toBe(JSON.stringify(events(5, { show: [1] })))
  })

  it('sorts the candidates best first and marks the chosen one', () => {
    const scored = {
      name: 'scored',
      decide: (s: Parameters<typeof bot.decide>[0], seat: number, rand: () => number, trace: Parameters<typeof bot.decide>[3]) => {
        const a = bot.decide(s, seat, rand, trace)
        // Unsorted on purpose, the chosen action in the middle.
        trace!.candidates.push(
          { action: a, score: 0.5, visits: 10, note: 'picked' },
          { action: observe(s, seat).legal[0], score: 0.25 },
          { action: observe(s, seat).legal[0], score: 0.75, visits: 3 },
        )
        return a
      },
    }
    const d = decisions(events(5, { show: [0] }, [scored, scored, scored, scored]))[0]
    expect(d.candidates.map((c) => c.score)).toEqual([0.75, 0.5, 0.25])
    const text = formatEvent({ type: 'decision', decision: d })
    expect(text).toMatch(/\* .+?\s{2,}0\.500\s+10\s+picked/)
    expect(text).toContain('candidates')
  })
})

describe('text output', () => {
  const es = events(5)
  const text = es.map((e) => formatEvent(e)).join('\n')

  it('writes cards as rank and suit symbol and has no colour codes', () => {
    expect(text).toMatch(/\b(?:A|K|Q|J|10|9)[♠♥♦♣]/)
    expect(text).not.toContain('\x1b')
    for (const label of ['hand ', 'trick ', 'trump ', 'turned ', 'lines ', 'legal ', 'chosen ', '> trick 1:', '>> hand 1 over:'])
      expect(text).toContain(label)
  })

  it('paints red suits only through the given paint function', () => {
    const d = decisions(es).find((x) => x.obs.hand.some((c) => c.s === 'H'))!
    const painted = formatEvent({ type: 'decision', decision: d }, (style, t) => `<${style}>${t}</>`)
    expect(painted).toMatch(/<red>\w+♥<\/>/)
    expect(painted).toContain('<bold>step ')
  })

  it('gives one JSON object per decision', () => {
    const d = decisions(es)[0]
    const o = JSON.parse(decisionJson(d))
    expect(o).toMatchObject({ step: d.step, seat: d.seat, kind: d.kind, rule: 0, algorithm: 'heuristic:normal' })
    expect(o.chosen).toEqual(d.chosen)
    expect(o.legal).toEqual(d.obs.legal)
  })
})

describe('npm run bot:trace', () => {
  const script = fileURLToPath(new URL('../scripts/bot-trace.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'bot-trace-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const run = (...args: string[]) => execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const SLOW = 60_000

  it('prints the same text for the same arguments, without colour on a pipe', () => {
    const a = run('--seed', '5', '--seats', '0', '--hand', '1')
    expect(a).toBe(run('--seed', '5', '--seats', '0', '--hand', '1'))
    expect(a).toContain('seat 0 | rule 0 heuristic:normal')
    expect(a).not.toMatch(/seat [123] \| rule/)
    expect(a).not.toContain('\x1b')
  }, SLOW)

  it('needs a seed', () => {
    expect(() => run()).toThrow(/--seed <n> is required/)
  }, SLOW)

  it('prints JSON lines with --json', () => {
    const lines = run('--seed', '5', '--json', '--to', '60').trim().split('\n')
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines) expect(JSON.parse(l)).toMatchObject({ rule: 0, algorithm: 'heuristic:normal' })
  }, SLOW)

  it('takes an id, inline JSON and a configuration file for --bot and --others', () => {
    const config = join(dir, 'mix.json')
    writeFileSync(
      config,
      JSON.stringify({
        name: 'mix',
        rules: [{ when: { phase: 'bidding' }, use: 'heuristic:easy' }, { use: { id: 'heuristic:hard' } }],
      }),
    )
    const algos = (out: string) => new Set(out.trim().split('\n').map((l) => JSON.parse(l).algorithm))
    const json = (...args: string[]) => run('--seed', '5', '--hand', '1', '--json', ...args)
    expect(algos(json('--bot', 'heuristic:hard'))).toEqual(new Set(['heuristic:hard']))
    expect(algos(json('--bot', '{"id":"heuristic:easy"}'))).toEqual(new Set(['heuristic:easy']))
    expect(algos(json('--bot', config))).toEqual(new Set(['heuristic:easy', 'heuristic:hard']))
    // --others without --seats: --bot plays seats 0 and 2, the rest play --others.
    const seats = new Set(json('--bot', 'heuristic:hard', '--others', 'heuristic:easy').trim().split('\n').map((l) => JSON.parse(l).seat))
    expect(seats).toEqual(new Set([0, 2]))
  }, SLOW)
})
