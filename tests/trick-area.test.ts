import { readFileSync } from 'node:fs'
import { compile } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

// Svelte's transition flags (svelte/src/constants.js).
const TRANSITION_IN = 1
const TRANSITION_GLOBAL = 4

describe('trick area', () => {
  it('flies in the first card of a hand', () => {
    // The first card creates the `{#if cards}` block and its card in one update; a
    // local intro does not run when its parent block is created, so it must be global.
    const source = readFileSync('src/components/TrickArea.svelte', 'utf8')
    const { js } = compile(source, { generate: 'client', filename: 'TrickArea.svelte' })
    const intros = [...js.code.matchAll(/\$\.transition\((\d+),/g)]
      .map((m) => Number(m[1]))
      .filter((flags) => flags & TRANSITION_IN)
    expect(intros).toHaveLength(1)
    expect(intros[0] & TRANSITION_GLOBAL).toBe(TRANSITION_GLOBAL)
  })
})
