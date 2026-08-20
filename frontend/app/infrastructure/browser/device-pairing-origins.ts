function exactHttpOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) return null
    return parsed.origin
  } catch {
    return null
  }
}

function configuredOrigins(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseTrustedDevicePairingOrigins(
  value: unknown,
  currentOrigin: string,
): readonly string[] {
  const current = exactHttpOrigin(currentOrigin)
  if (!current) throw new TypeError('current device-pairing origin is invalid')

  const configured = configuredOrigins(value)
  if (!configured) return [current]
  const origins = [...new Set(configured.map(exactHttpOrigin).filter(origin => origin !== null))]
  return origins.includes(current) ? origins : [current]
}
