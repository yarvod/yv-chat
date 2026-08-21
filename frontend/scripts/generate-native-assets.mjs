import { resolve } from 'node:path'

import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const icon = resolve(root, 'design/brand/yv-chat-icon-master.png')
const symbol = resolve(root, 'design/brand/yv-chat-symbol.svg')
const android = resolve(root, 'android/app/src/main/res')
const ios = resolve(root, 'ios/App/App/Assets.xcassets')
const midnight = '#07111f'

const androidDensities = {
  mdpi: { icon: 48, foreground: 108 },
  hdpi: { icon: 72, foreground: 162 },
  xhdpi: { icon: 96, foreground: 216 },
  xxhdpi: { icon: 144, foreground: 324 },
  xxxhdpi: { icon: 192, foreground: 432 },
}

async function brandedIcon(size, output) {
  await sharp(icon).resize(size, size).png({ compressionLevel: 9 }).toFile(output)
}

async function transparentSymbol(size, output) {
  await sharp(symbol, { density: 1024 })
    .resize(Math.round(size * 0.62), Math.round(size * 0.62), { fit: 'contain' })
    .extend({
      top: Math.floor(size * 0.19),
      bottom: Math.ceil(size * 0.19),
      left: Math.floor(size * 0.19),
      right: Math.ceil(size * 0.19),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(output)
}

async function splash(size, output) {
  const mark = await sharp(symbol, { density: 1024 })
    .resize(Math.round(size * 0.28), Math.round(size * 0.28), { fit: 'contain' })
    .png()
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: midnight },
  }).composite([{ input: mark, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(output)
}

for (const [density, sizes] of Object.entries(androidDensities)) {
  const directory = resolve(android, `mipmap-${density}`)
  await Promise.all([
    brandedIcon(sizes.icon, resolve(directory, 'ic_launcher.png')),
    brandedIcon(sizes.icon, resolve(directory, 'ic_launcher_round.png')),
    transparentSymbol(sizes.foreground, resolve(directory, 'ic_launcher_foreground.png')),
  ])
}

await brandedIcon(
  1024,
  resolve(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'),
)

const splashTargets = [
  ['drawable', 480],
  ['drawable-land-mdpi', 480],
  ['drawable-land-hdpi', 800],
  ['drawable-land-xhdpi', 1280],
  ['drawable-land-xxhdpi', 1600],
  ['drawable-land-xxxhdpi', 1920],
  ['drawable-port-mdpi', 480],
  ['drawable-port-hdpi', 800],
  ['drawable-port-xhdpi', 1280],
  ['drawable-port-xxhdpi', 1600],
  ['drawable-port-xxxhdpi', 1920],
]
await Promise.all(splashTargets.map(([directory, size]) => (
  splash(size, resolve(android, directory, 'splash.png'))
)))
await Promise.all([
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
].map(name => splash(2732, resolve(ios, 'Splash.imageset', name))))
