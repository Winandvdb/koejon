import { readFileSync } from 'node:fs'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

type Node = { type: string; name?: string; modifiers?: string[]; [key: string]: unknown }

/** Every node in the template with the chain of its ancestors. */
function* walk(node: unknown, path: Node[] = []): Generator<[Node, Node[]]> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n, path)
    return
  }
  if (!node || typeof node !== 'object') return
  const n = node as Node
  if (typeof n.type === 'string') yield [n, path]
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'expression' && key !== 'metadata') yield* walk(value, typeof n.type === 'string' ? [...path, n] : path)
  }
}

describe('trick area', () => {
  const ast = parse(readFileSync('src/components/TrickArea.svelte', 'utf8'), { modern: true })
  const nodes = [...walk(ast.fragment)]
  const flies = nodes.filter(([n]) => n.type === 'TransitionDirective' && n.name === 'fly')

  it('flies in the first card of a hand', () => {
    // A local intro does not run when its parent block is created: the trick
    // cards must not sit in a block that the first card of a hand creates.
    expect(flies).toHaveLength(2)
    for (const [, path] of flies) {
      expect(path.some((n) => n.type === 'EachBlock')).toBe(true)
      expect(path.some((n) => n.type === 'IfBlock')).toBe(false)
    }
  })

  it('does not fly in the cards already on the felt when the table mounts', () => {
    for (const [n] of flies) expect(n.modifiers).not.toContain('global')
  })
})
