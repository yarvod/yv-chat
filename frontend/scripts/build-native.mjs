import { spawn } from 'node:child_process'

const apiOrigin = process.env.YV_CHAT_NATIVE_API_ORIGIN
const pairingOriginsValue = process.env.YV_CHAT_NATIVE_DEVICE_PAIRING_ORIGINS
if (!apiOrigin) {
  console.error('YV_CHAT_NATIVE_API_ORIGIN is required (for example https://chat.example)')
  process.exit(1)
}
if (!pairingOriginsValue) {
  console.error('YV_CHAT_NATIVE_DEVICE_PAIRING_ORIGINS is required as a JSON array')
  process.exit(1)
}

let parsed
try {
  parsed = new URL(apiOrigin)
} catch {
  console.error('YV_CHAT_NATIVE_API_ORIGIN must be an exact HTTPS origin')
  process.exit(1)
}
if (
  parsed.protocol !== 'https:'
  || parsed.pathname !== '/'
  || parsed.search
  || parsed.hash
  || parsed.username
  || parsed.password
) {
  console.error('YV_CHAT_NATIVE_API_ORIGIN must be an exact HTTPS origin')
  process.exit(1)
}

function exactTrustedOrigin(value) {
  if (typeof value !== 'string') return null
  try {
    const candidate = new URL(value)
    if (['http:', 'https:'].includes(candidate.protocol)) {
      return candidate.origin === value ? candidate.origin : null
    }
    if (candidate.protocol !== 'capacitor:' || !candidate.host) return null
    const origin = `${candidate.protocol}//${candidate.host}`
    return origin === value ? origin : null
  } catch {
    return null
  }
}

let pairingOrigins
try {
  const parsedOrigins = JSON.parse(pairingOriginsValue)
  if (!Array.isArray(parsedOrigins)) throw new TypeError('not an array')
  pairingOrigins = [...new Set(parsedOrigins.map(exactTrustedOrigin))]
} catch {
  console.error('YV_CHAT_NATIVE_DEVICE_PAIRING_ORIGINS must be a JSON array of exact origins')
  process.exit(1)
}

if (
  pairingOrigins.some(origin => origin === null)
  || !pairingOrigins.includes(parsed.origin)
  || !pairingOrigins.includes('https://app.yvchat.local')
  || !pairingOrigins.includes('capacitor://app.yvchat.local')
) {
  console.error(
    'native pairing origins must contain the API, Android and iOS local exact origins',
  )
  process.exit(1)
}

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'generate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NUXT_PUBLIC_API_ORIGIN: parsed.origin,
    NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS: JSON.stringify(pairingOrigins),
    NUXT_PUBLIC_NATIVE_BUILD: 'true',
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
