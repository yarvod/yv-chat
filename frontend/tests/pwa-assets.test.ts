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
    ['icons/icon-v3-any-192.png', 192, 192],
    ['icons/icon-v3-any-512.png', 512, 512],
    ['icons/icon-v3-maskable-192.png', 192, 192],
    ['icons/icon-v3-maskable-512.png', 512, 512],
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
    expect(config).toContain("{ rel: 'manifest', href: '/manifest.webmanifest' }")
    expect(config).toContain("purpose: 'maskable'")
    expect(config).toContain('/icons/icon-v3-maskable-512.png')
    expect(config).not.toContain('/icons/icon-v2-')
    expect(config).not.toContain('icon-v3-any-64')
    expect(config).toContain("rel: 'apple-touch-startup-image'")
    expect(config).toContain('viewport-fit=cover')
    expect(config).toContain("'splash/**/*.png'")
    expect(config).toContain("'icons/icon-v2-*.png'")
    expect(config).toContain("'crypto/v1/**/*'")
    expect(config).toContain("'crypto/v2/**/*'")
    expect(config).toContain("'crypto/v3/**/*'")
  })

  it('automatically activates updates and checks for them periodically', () => {
    const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')
    const lifecycle = readFileSync(
      resolve(process.cwd(), 'app/plugins/pwa-lifecycle.client.ts'),
      'utf8',
    )
    expect(config).toContain("registerType: 'autoUpdate'")
    expect(lifecycle).toContain('PwaUpdateCoordinator')
    expect(lifecycle).not.toContain('indexedDB.deleteDatabase')
  })

  it('keeps standard artwork transparent and the maskable canvas fully opaque', async () => {
    const transparent = await sharp(resolve(process.cwd(), 'public/icons/icon-v3-any-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const maskable = await sharp(resolve(process.cwd(), 'public/icons/icon-v3-maskable-512.png'))
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

  it('matches every maskable canvas edge to the Android splash background', async () => {
    const transparent = await sharp(resolve(
      process.cwd(),
      'public/icons/icon-v3-any-512.png',
    )).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const image = await sharp(resolve(
      process.cwd(),
      'public/icons/icon-v3-maskable-512.png',
    )).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const rgbaAt = (x: number, y: number) => {
      const offset = (y * image.info.width + x) * image.info.channels
      return Array.from(image.data.subarray(offset, offset + 4))
    }
    const midnight = [7, 17, 31, 255]
    for (const [x, y] of [
      [0, 0], [256, 0], [511, 0],
      [0, 256], [511, 256],
      [0, 511], [256, 511], [511, 511],
    ]) expect(rgbaAt(x, y)).toEqual(midnight)

    let uncoveredBackgroundMismatches = 0
    let maximumCoreRadius = 0
    for (let y = 0; y < image.info.height; y += 1) {
      for (let x = 0; x < image.info.width; x += 1) {
        const offset = (y * image.info.width + x) * image.info.channels
        const alpha = transparent.data[offset + 3] ?? 0
        if (alpha === 0 && rgbaAt(x, y).some((channel, index) => channel !== midnight[index])) {
          uncoveredBackgroundMismatches += 1
        }
        if (alpha >= 17) {
          maximumCoreRadius = Math.max(maximumCoreRadius, Math.hypot(x - 255.5, y - 255.5))
        }
      }
    }
    expect(uncoveredBackgroundMismatches).toBe(0)
    expect(maximumCoreRadius).toBeLessThanOrEqual(512 * 0.4)

    const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')
    expect(config).toContain("background_color: '#07111f'")
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
    expect(readFileSync(
      resolve(process.cwd(), 'public/brand/yv-chat-symbol.svg'),
      'utf8',
    )).toBe(source)
  })
})
