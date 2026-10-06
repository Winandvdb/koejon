import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('hosting and SEO', () => {
  test('index.html has a meta description', () => {
    expect(readFileSync('index.html', 'utf8')).toMatch(/<meta name="description" content="[^"]{50,}"/)
  })

  test('robots.txt is a real robots file', () => {
    const robots = readFileSync('public/robots.txt', 'utf8')
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).not.toContain('<')
  })

  test('every response forbids framing and isolates the opener', () => {
    const { hosting } = JSON.parse(readFileSync('firebase.json', 'utf8'))
    const all = hosting.headers.find((h: { source: string }) => h.source === '**')
    const map = Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]))
    expect(map['X-Frame-Options']).toBe('DENY')
    expect(map['Content-Security-Policy']).toBe("frame-ancestors 'none'")
    expect(map['Cross-Origin-Opener-Policy']).toBe('same-origin')
  })
})
