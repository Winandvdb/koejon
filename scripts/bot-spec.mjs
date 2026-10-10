// Shared bot-spec handling for the benchmark and bot:trace: a side is
// "[<git ref>@]<spec>" where <spec> is an algorithm id ('heuristic:hard'),
// inline JSON ('{"id":"pimc","iterations":500}') or a path to a bot
// configuration file. No ref means this checkout. A ref without the bot
// framework, or no spec at all, falls back to that checkout's botAction.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** @typedef {import('../src/bots/algorithm.ts').AlgorithmSpec | import('../src/bots/bot.ts').BotConfig} BotSpec */

/** `p` names a regular file: false for missing paths, directories, devices and fifos. */
function isFile(/** @type {string} */ p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Parse the spec part of a side argument. A leading '{' is inline JSON, a
 * '.json' path or existing file is read as JSON, anything else is an
 * algorithm id.
 * @param {string} text
 * @returns {BotSpec}
 */
export function parseSpec(text) {
  const s = text.trim()
  if (s.startsWith('{')) return JSON.parse(s)
  if (s.endsWith('.json') || isFile(s)) {
    try {
      return JSON.parse(readFileSync(s, 'utf8'))
    } catch (e) {
      throw new Error(`cannot read bot spec file ${s}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return s
}

/**
 * Parse "[ref@]spec". An arg that starts with '{' or names an existing file
 * has no ref prefix.
 * @param {string} arg
 * @returns {{ ref: string | null, spec: BotSpec }}
 */
export function parseSpecArg(arg) {
  const at = arg.indexOf('@')
  if (at > 0 && !arg.startsWith('{') && !isFile(arg))
    return { ref: arg.slice(0, at), spec: parseSpec(arg.slice(at + 1)) }
  return { ref: null, spec: parseSpec(arg) }
}

/**
 * Extract `ref`'s src/ into a fresh directory under `tmp` and return it, so
 * its modules load with their own imports intact.
 * @param {string} root  git working tree to run `git archive` in
 * @param {string} ref
 * @param {string} tmp   parent directory for the new directory
 */
export function extractRef(root, ref, tmp) {
  // A ref is argv to git archive: a leading '-' would inject options.
  if (ref.startsWith('-')) throw new Error(`git ref must not start with '-': ${ref}`)
  const dir = mkdtempSync(join(tmp, 'ref-'))
  const tar = join(dir, 'src.tar')
  execFileSync('git', ['archive', '--format=tar', '-o', tar, ref, 'src'], { cwd: root })
  execFileSync('tar', ['-xf', tar, '-C', dir])
  return dir
}

/**
 * Load a side's decider through the vite `server`. `dir` null means this
 * checkout. Uses `createBot` when the checkout has the bot framework (a null
 * spec becomes the `heuristic:<level>` bot), else its `botAction`; a spec is
 * ignored on old refs.
 * @param {import('vite').ViteDevServer} server
 * @param {string | null} dir
 * @param {BotSpec | null} spec
 * @param {string} level
 */
export async function loadDecider(server, dir, spec, level) {
  const mod = await server.ssrLoadModule(dir ? join(dir, 'src/bots/bot.ts') : '/src/bots/bot.ts')
  if (typeof mod.createBot === 'function') {
    const bot = mod.createBot(spec ?? `heuristic:${level}`)
    return {
      name: bot.name,
      legacy: false,
      /** @param {object} s @param {number} seat @param {() => number} rand @param {object} [trace] */
      decide: (s, seat, rand, trace) => bot.decide(s, seat, rand, trace),
    }
  }
  if (typeof mod.botAction !== 'function')
    throw new Error(`no bot in ${dir ?? 'this checkout'}: src/bots/bot.ts exports neither createBot nor botAction`)
  return {
    name: `botAction:${level}`,
    legacy: true,
    /** @param {object} s @param {number} seat @param {() => number} rand */
    decide: (s, seat, rand) => mod.botAction(s, seat, rand, level),
  }
}

const FIXED_FIRST = new Set(['draw', 'cut', 'chooseDealer'])

/**
 * 'bidding' or 'play' when the legal actions are a real choice; null for the
 * steps every bot plays the same way (a single action, draws, cuts, the
 * first dealer pick). Mirrors `fixedStep` in src/bots/bot.ts.
 * @param {{ type: string }[]} legal
 * @returns {'bidding' | 'play' | null}
 */
export function realDecisionPhase(legal) {
  if (legal.length <= 1 || FIXED_FIRST.has(legal[0].type)) return null
  return legal[0].type === 'play' ? 'play' : 'bidding'
}
