import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiRequest } from '../app/services/api'
import { parseCurrentAccount } from '../app/services/parsers'

afterEach(() => vi.restoreAllMocks())

describe('api boundary', () => {
  it('uses same-origin cookies and a CSRF header for writes', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-yv_csrf=csrf-test')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await apiRequest('/api/v1/auth/logout', { method: 'POST' })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test')
  })

  it('rejects malformed account JSON at the boundary', () => {
    expect(() => parseCurrentAccount({ username: 'alice' })).toThrow(ApiError)
  })
})
