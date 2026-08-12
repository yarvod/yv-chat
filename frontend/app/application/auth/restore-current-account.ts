import type { CurrentAccount } from '../../domain/accounts/account'
import { ApplicationError } from '../errors'

const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const

export function isTransientSessionBootstrapError(error: unknown): boolean {
  return error instanceof ApplicationError && (
    error.kind === 'network'
    || error.kind === 'invalid-response'
    || error.status === 408
    || error.status === 429
    || (error.status !== null && error.status >= 500)
  )
}

export async function restoreCurrentAccount(
  load: () => Promise<CurrentAccount>,
  wait: (delayMs: number) => Promise<void>,
): Promise<CurrentAccount> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load()
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt]
      if (!isTransientSessionBootstrapError(error) || delay === undefined) throw error
      await wait(delay)
    }
  }
}
