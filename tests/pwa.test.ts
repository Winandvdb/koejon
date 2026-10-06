import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { precache, swSource } from '../pwa/precache'

const BUILD = {
  'index.html': '<script src="/assets/index-abc.js"></script>',
  'assets/index-abc.js': 'console.log(1)',
  'assets/index-abc.js.map': '{}',
  'icon-192.png': new Uint8Array([1, 2, 3]),
  'sw.js': 'old worker',
}

describe('service worker precache', () => {
  test('lists every built file, the shell as /, without the worker or maps', () => {
    expect(precache(BUILD).files.sort()).toEqual(['/', '/assets/index-abc.js', '/icon-192.png'])
  })

  test('a new deploy gets a new version, an identical one keeps it', () => {
    const v = precache(BUILD).version
    expect(precache({ ...BUILD }).version).toBe(v)
    expect(precache({ ...BUILD, 'icon-192.png': new Uint8Array([9]) }).version).not.toBe(v)
    expect(precache({ ...BUILD, 'assets/index-def.js': 'x' }).version).not.toBe(v)
  })

  test('fills the worker template', () => {
    const src = swSource(readFileSync('pwa/sw.js', 'utf8'), BUILD)
    expect(src).not.toContain('__PRECACHE__')
    expect(src).toContain(JSON.stringify(precache(BUILD)))
  })
})

describe('web app manifest', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))

  test('has what install prompts need', () => {
    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.theme_color).toBeTruthy()
    expect(m.background_color).toBeTruthy()
    const sizes = m.icons.filter((i: { type: string }) => i.type === 'image/png').map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  })

  test('every icon file exists', () => {
    for (const i of m.icons) expect(() => readFileSync(`public${i.src}`)).not.toThrow()
  })
})
