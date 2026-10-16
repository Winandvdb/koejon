import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('side-seat nameplates', () => {
  test('a wrapped name is centred on each line at phone width', () => {
    const css = readFileSync('src/app.css', 'utf8')
    expect(css).toMatch(/\.seat-p1 \.np-name,\s*\.seat-p3 \.np-name \{[^}]*text-align:\s*center/)
  })
})
