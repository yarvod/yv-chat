import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(projectRoot, 'design/brand/yv-chat-symbol.svg')
const icons = resolve(projectRoot, 'public/icons')
const midnight = '#07111f'

await mkdir(icons, { recursive: true })

function radialBackgroundSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="halo" cx="50%" cy="45%" r="70%">
        <stop offset="0" stop-color="#17285b" />
        <stop offset="0.52" stop-color="${midnight}" />
        <stop offset="1" stop-color="#040a16" />
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#halo)" />
  </svg>`)
}

function solidBackgroundSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${midnight}" />
  </svg>`)
}

async function symbol(size) {
  return sharp(source, { density: 1024 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

async function transparent(size, path) {
  await sharp(await symbol(size))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path)
}

async function opaque(size, path, background) {
  await sharp(background(size))
    .composite([{ input: await symbol(size) }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path)
}

await Promise.all([
  transparent(32, resolve(icons, 'favicon-32.png')),
  transparent(192, resolve(icons, 'icon-v3-any-192.png')),
  transparent(512, resolve(icons, 'icon-v3-any-512.png')),
  opaque(192, resolve(icons, 'icon-v3-maskable-192.png'), solidBackgroundSvg),
  opaque(512, resolve(icons, 'icon-v3-maskable-512.png'), solidBackgroundSvg),
  opaque(152, resolve(icons, 'apple-touch-icon-152.png'), radialBackgroundSvg),
  opaque(167, resolve(icons, 'apple-touch-icon-167.png'), radialBackgroundSvg),
  opaque(180, resolve(projectRoot, 'public/apple-touch-icon.png'), radialBackgroundSvg),
])
