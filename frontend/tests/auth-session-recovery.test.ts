import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { restoreCurrentAccount } from '../app/application/auth/restore-current-account'

const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  deviceId: '1a166081-37d5-40ea-8238-3f639e7be090',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
}

describe('current session recovery', () => {
  it('retries transient deploy-window failures without creating a new login', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new ApplicationError(502, 'http', 'bad gateway'))
      .mockRejectedValueOnce(new ApplicationError(503, 'http', 'unavailable'))
      .mockResolvedValueOnce(account)
    const waits: number[] = []

    await expect(restoreCurrentAccount(
      load,
      async delayMs => { waits.push(delayMs) },
    )).resolves.toEqual(account)

    expect(load).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([250, 500])
  })

  it('does not retry an authoritative unauthorized response', async () => {
    const unauthorized = new ApplicationError(401, 'http', 'unauthorized')
    const load = vi.fn().mockRejectedValue(unauthorized)
    const wait = vi.fn()

    await expect(restoreCurrentAccount(load, wait)).rejects.toBe(unauthorized)
    expect(load).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it.each([
    new ApplicationError(null, 'network', 'offline'),
    new ApplicationError(200, 'invalid-response', 'invalid response'),
    new ApplicationError(408, 'http', 'timeout'),
    new ApplicationError(429, 'http', 'rate limited'),
    new ApplicationError(500, 'http', 'server failure'),
  ])('classifies %s as transient', async error => {
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(account)
    await expect(restoreCurrentAccount(load, async () => undefined)).resolves.toEqual(account)
  })
})
