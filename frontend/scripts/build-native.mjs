import { spawn } from 'node:child_process'

const apiOrigin = process.env.YV_CHAT_NATIVE_API_ORIGIN
if (!apiOrigin) {
  console.error('YV_CHAT_NATIVE_API_ORIGIN is required (for example https://chat.example)')
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

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'generate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NUXT_PUBLIC_API_ORIGIN: parsed.origin,
    NUXT_PUBLIC_NATIVE_BUILD: 'true',
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
