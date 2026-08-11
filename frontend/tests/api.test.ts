import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { ApiClient } from '../app/infrastructure/http/api-client'
import { HttpMessagingGateway } from '../app/infrastructure/http/messaging-gateway'
import { parseCurrentAccount } from '../app/infrastructure/http/runtime-parsers'

afterEach(() => vi.restoreAllMocks())

describe('api boundary', () => {
  it('sends group management mutations through encoded CSRF-protected routes', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-yv_csrf=csrf-test')
    const response = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      conversation_type: 'group',
      title: 'Core team',
      created_by: '22222222-2222-4222-8222-222222222222',
      created_at: '2026-08-11T12:00:00Z',
      updated_at: '2026-08-11T12:01:00Z',
      members: [],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const gateway = new HttpMessagingGateway(new ApiClient())

    await gateway.renameGroup('conversation/1', 'Core team')
    await gateway.addGroupMember('conversation/1', 'user/2')
    await gateway.removeGroupMember('conversation/1', 'user/2')

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ['/api/v1/conversations/conversation%2F1', 'PATCH'],
      ['/api/v1/conversations/conversation%2F1/members', 'POST'],
      ['/api/v1/conversations/conversation%2F1/members/user%2F2', 'DELETE'],
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test')
    }
  })

  it('uses same-origin cookies and a CSRF header for writes', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-yv_csrf=csrf-test')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await new ApiClient().request('/api/v1/auth/logout', { method: 'POST' })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test')
  })

  it('rejects malformed account JSON at the boundary', () => {
    expect(() => parseCurrentAccount({ username: 'alice' })).toThrow(ApplicationError)
  })

  it('requests an exclusive before cursor for bounded history pages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        messages: [],
        has_more: false,
        oldest_sequence: null,
        newest_sequence: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await new HttpMessagingGateway(new ApiClient()).listMessageHistory(
      'conversation/id',
      106,
      100,
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/conversations/conversation%2Fid/messages/history?limit=100&before_sequence=106',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('returns a strictly parsed authoritative receipt for an idempotent send', async () => {
    const response = {
      message_id: 'message-1',
      client_message_id: 'client-1',
      conversation_id: 'conversation-1',
      sender_user_id: 'user-1',
      sender_device_id: 'device-1',
      protocol_version: 1,
      sequence: 7,
      created_at: '2026-08-11T12:00:01Z',
      expires_at: '2026-09-10T12:00:01Z',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(new HttpMessagingGateway(new ApiClient()).sendMessage(
      'conversation-1', 'client-1', 1, 'Y2lwaGVydGV4dA==',
    )).resolves.toMatchObject({ messageId: 'message-1', sequence: 7 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/conversations/conversation-1/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          client_message_id: 'client-1',
          protocol_version: 1,
          ciphertext_base64: 'Y2lwaGVydGV4dA==',
        }),
      }),
    )
  })

  it('fetches one opaque message by encoded conversation and message ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        message_id: 'message/1',
        client_message_id: 'client-1',
        conversation_id: 'conversation/1',
        sender_user_id: 'user-1',
        sender_device_id: 'device-1',
        protocol_version: 1,
        sequence: 1,
        created_at: '2026-08-11T12:00:00Z',
        expires_at: '2026-09-10T12:00:00Z',
        ciphertext_base64: null,
        deletion_reason: 'manual',
        deleted_at: '2026-08-11T12:01:00Z',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await new HttpMessagingGateway(new ApiClient()).getMessage(
      'conversation/1',
      'message/1',
    )

    expect(result.deletionReason).toBe('manual')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/conversations/conversation%2F1/messages/message%2F1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})
