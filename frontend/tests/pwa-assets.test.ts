import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function pngDimensions(relativePath: string): { width: number, height: number } {
  const bytes = readFileSync(resolve(process.cwd(), 'public', relativePath))
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

describe('PWA install assets', () => {
  it.each([
    ['icons/favicon-32.png', 32, 32],
    ['icons/icon-64.png', 64, 64],
    ['icons/icon-192.png', 192, 192],
    ['icons/icon-512.png', 512, 512],
    ['icons/icon-maskable-192.png', 192, 192],
    ['icons/icon-maskable-512.png', 512, 512],
    ['icons/apple-touch-icon-152.png', 152, 152],
    ['icons/apple-touch-icon-167.png', 167, 167],
    ['apple-touch-icon.png', 180, 180],
  ])('%s has its declared dimensions', (path, width, height) => {
    expect(pngDimensions(path)).toEqual({ width, height })
  })

  it.each([
    ['splash/launch-750x1334.png', 750, 1334],
    ['splash/launch-828x1792.png', 828, 1792],
    ['splash/launch-1125x2436.png', 1125, 2436],
    ['splash/launch-1170x2532.png', 1170, 2532],
    ['splash/launch-1179x2556.png', 1179, 2556],
    ['splash/launch-1206x2622.png', 1206, 2622],
    ['splash/launch-1260x2736.png', 1260, 2736],
    ['splash/launch-1284x2778.png', 1284, 2778],
    ['splash/launch-1290x2796.png', 1290, 2796],
    ['splash/launch-1320x2868.png', 1320, 2868],
    ['splash/launch-1668x2388.png', 1668, 2388],
    ['splash/launch-2048x2732.png', 2048, 2732],
    ['splash/launch-2064x2752.png', 2064, 2752],
  ])('%s has its exact launch dimensions', (path, width, height) => {
    expect(pngDimensions(path)).toEqual({ width, height })
  })

  it('keeps install identity, maskable purpose, and splash precache policy explicit', () => {
    const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')
    expect(config).toContain("id: '/'")
    expect(config).toContain("start_url: '/'")
    expect(config).toContain("purpose: 'maskable'")
    expect(config).toContain("rel: 'apple-touch-startup-image'")
    expect(config).toContain('viewport-fit=cover')
    expect(config).toContain("globIgnores: ['splash/**/*.png']")
  })
})
