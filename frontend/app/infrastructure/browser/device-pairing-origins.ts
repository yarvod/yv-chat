function exactTrustedOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return parsed.origin === value ? parsed.origin : null
    }
    if (parsed.protocol !== 'capacitor:' || !parsed.host) return null
    const origin = `${parsed.protocol}//${parsed.host}`
    return origin === value ? origin : null
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
  const current = exactTrustedOrigin(currentOrigin)
  if (!current) throw new TypeError('current device-pairing origin is invalid')

  const configured = configuredOrigins(value)
  if (!configured) return [current]
  const origins = [...new Set(configured.map(exactTrustedOrigin).filter(origin => origin !== null))]
  return origins.includes(current) ? origins : [current]
}
