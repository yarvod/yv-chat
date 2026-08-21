import { CapacitorCookies } from '@capacitor/core'

const CSRF_COOKIE_NAME = '__Host-yv_csrf'

export async function capacitorCsrfToken(apiOrigin: string): Promise<string | null> {
  if (!apiOrigin) return null
  const cookies = await CapacitorCookies.getCookies({ url: apiOrigin })
  return cookies[CSRF_COOKIE_NAME] ?? null
}
