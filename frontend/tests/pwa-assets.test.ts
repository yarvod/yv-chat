import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

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
    ['icons/icon-v2-64.png', 64, 64],
    ['icons/icon-v2-192.png', 192, 192],
    ['icons/icon-v2-512.png', 512, 512],
    ['icons/icon-v2-maskable-192.png', 192, 192],
    ['icons/icon-v2-maskable-512.png', 512, 512],
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
    expect(config).toContain('/icons/icon-v2-maskable-512.png')
    expect(config).toContain("rel: 'apple-touch-startup-image'")
    expect(config).toContain('viewport-fit=cover')
    expect(config).toContain("'splash/**/*.png'")
    expect(config).toContain("'crypto/v1/**/*'")
    expect(config).toContain("'crypto/v2/**/*'")
    expect(config).toContain("'crypto/v3/**/*'")
  })

  it('offers activation of a waiting service worker without erasing local state', () => {
    const app = readFileSync(resolve(process.cwd(), 'app/app.vue'), 'utf8')
    expect(app).toContain('$pwa?.needRefresh')
    expect(app).toContain('$pwa.updateServiceWorker(true)')
    expect(app).toContain('Локальные чаты и ключи сохранятся')
    expect(app).not.toContain('indexedDB.deleteDatabase')
  })

  it('keeps standard artwork transparent and the maskable canvas fully opaque', async () => {
    const transparent = await sharp(resolve(process.cwd(), 'public/icons/icon-v2-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const maskable = await sharp(resolve(process.cwd(), 'public/icons/icon-v2-maskable-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alphaAt = (
      image: typeof transparent,
      x: number,
      y: number,
    ) => image.data[(y * image.info.width + x) * image.info.channels + 3]

    expect(alphaAt(transparent, 0, 0)).toBe(0)
    expect(alphaAt(transparent, 511, 511)).toBe(0)
    expect(alphaAt(maskable, 0, 0)).toBe(255)
    expect(alphaAt(maskable, 511, 511)).toBe(255)
    let minimumAlpha = 255
    for (let index = 3; index < maskable.data.length; index += maskable.info.channels) {
      minimumAlpha = Math.min(minimumAlpha, maskable.data[index] ?? 0)
    }
    expect(minimumAlpha).toBe(255)
  })

  it('uses a vector mark without a baked platform shape inside the safe zone', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'design/brand/yv-chat-symbol.svg'),
      'utf8',
    )
    expect(source).toContain('viewBox="0 0 512 512"')
    expect(source).toContain('data-safe-zone-radius="204.8"')
    expect(source).not.toContain('<rect')
    expect(source.match(/<path /g)).toHaveLength(3)
  })
})
