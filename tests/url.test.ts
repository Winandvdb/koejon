import { afterEach, expect, test, vi } from 'vitest'
import { appUrl } from '../src/lib/url'

afterEach(() => vi.unstubAllGlobals())

test('appUrl keeps the path and only sets ?room=', () => {
  vi.stubGlobal('location', { pathname: '/koejon/', search: '?p2p=off' })
  expect(appUrl()).toBe('/koejon/')
  expect(appUrl('ABCDE')).toBe('/koejon/?room=ABCDE')
})
