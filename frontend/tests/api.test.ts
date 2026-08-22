import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { ApiClient, resolveApiUrl } from '../app/infrastructure/http/api-client'
import { HttpAttachmentGateway } from '../app/infrastructure/http/attachment-gateway'
import { HttpMessagingGateway } from '../app/infrastructure/http/messaging-gateway'
import { parseCurrentAccount } from '../app/infrastructure/http/runtime-parsers'

class FakeXMLHttpRequest {
  static readonly instances: FakeXMLHttpRequest[] = []
  static nextStatus = 201
  static nextResponseText = JSON.stringify({ accepted: true })
  static failNetwork = false

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null
  } = { onprogress: null }

  readonly headers = new Map<string, string>()
  method = ''
  path = ''
  withCredentials = false
  status = FakeXMLHttpRequest.nextStatus
  responseText = FakeXMLHttpRequest.nextResponseText
  sentBody: Document | XMLHttpRequestBodyInit | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onload: (() => void) | null = null

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method: string, path: string): void {
    this.method = method
    this.path = path
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value)
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.sentBody = body
    this.upload.onprogress?.({ loaded: 2 } as ProgressEvent)
    if (FakeXMLHttpRequest.failNetwork) this.onerror?.()
    else this.onload?.()
  }

  static reset(): void {
    this.instances.length = 0
    this.nextStatus = 201
    this.nextResponseText = JSON.stringify({ accepted: true })
    this.failNetwork = false
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  FakeXMLHttpRequest.reset()
})

describe('api boundary', () => {
  it('keeps web URLs relative and resolves native URLs only against an explicit origin', () => {
    expect(resolveApiUrl('/api/v1/auth/session', '')).toBe('/api/v1/auth/session')
    expect(resolveApiUrl('/api/v1/auth/session', 'https://chat.example')).toBe(
      'https://chat.example/api/v1/auth/session',
    )
    expect(() => resolveApiUrl('api/v1/auth/session', 'https://chat.example')).toThrow(TypeError)
  })

  it('reports actual binary upload bytes while preserving cookie and CSRF semantics', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-yv_csrf=csrf-upload')
    const body = new Blob(['hello'])
    const onProgress = vi.fn()

    await expect(new ApiClient().upload('/binary', body, onProgress)).resolves.toEqual({
      accepted: true,
    })

    const request = FakeXMLHttpRequest.instances[0]
    expect(request).toMatchObject({
      method: 'PUT',
      path: '/binary',
      withCredentials: true,
      sentBody: body,
    })
    expect(request?.headers.get('x-csrf-token')).toBe('csrf-upload')
    expect(request?.headers.get('content-type')).toBe('application/octet-stream')
    expect(onProgress.mock.calls.map(([progress]) => progress.uploadedBytes)).toEqual([0, 2, 5])
    expect(onProgress).toHaveBeenLastCalledWith({ uploadedBytes: 5, totalBytes: 5 })
  })

  it('preserves typed HTTP, network and invalid-response failures for binary uploads', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const apiClient = new ApiClient()
    const body = new Blob(['hello'])

    FakeXMLHttpRequest.nextStatus = 413
    await expect(apiClient.upload('/too-large', body)).rejects.toMatchObject({
      status: 413,
      kind: 'http',
    })

    FakeXMLHttpRequest.nextStatus = 201
    FakeXMLHttpRequest.failNetwork = true
    await expect(apiClient.upload('/offline', body)).rejects.toMatchObject({
      status: null,
      kind: 'network',
    })

    FakeXMLHttpRequest.failNetwork = false
    FakeXMLHttpRequest.nextResponseText = '{broken'
    await expect(apiClient.upload('/invalid', body)).rejects.toMatchObject({
      status: 201,
      kind: 'invalid-response',
    })
  })

  it('hashes attachment bodies incrementally without materializing the whole Blob', async () => {
    const body = new Blob(['hello'], { type: 'video/mp4' })
    const wholeBlobRead = vi.spyOn(body, 'arrayBuffer').mockRejectedValue(
      new Error('whole blob read is forbidden'),
    )
    const apiClient = new ApiClient()
    const upload = vi.spyOn(apiClient, 'upload').mockImplementation(async path => {
      const query = new URL(path, 'http://localhost').searchParams
      return {
        attachment_id: 'attachment-1',
        client_attachment_id: 'client-1',
        conversation_id: 'conversation-1',
        media_kind: 'video',
        content_type: 'video/mp4',
        byte_size: body.size,
        sha256_digest: query.get('sha256'),
        created_at: '2026-08-12T12:00:00Z',
        expires_at: '2026-09-11T12:00:00Z',
      }
    })

    await new HttpAttachmentGateway(apiClient).upload('conversation-1', {
      clientAttachmentId: 'client-1',
      kind: 'video',
      contentType: 'video/mp4',
      byteSize: body.size,
      body,
    })

    expect(wholeBlobRead).not.toHaveBeenCalled()
    expect(upload.mock.calls[0]?.[0]).toContain(
      'sha256=2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

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
    expect(new Headers(init?.headers).has('Origin')).toBe(false)
    expect(new Headers(init?.headers).has('X-YV-Native-Origin')).toBe(false)
  })

  it('uses explicit native origin and asynchronous CSRF reader without bearer credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await new ApiClient(
      'https://chat.example',
      async () => 'native-csrf',
      'https://app.yvchat.local',
    ).request('/api/v1/auth/logout', { method: 'POST' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://chat.example/api/v1/auth/logout')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('native-csrf')
    expect(new Headers(init?.headers).has('Origin')).toBe(false)
    expect(new Headers(init?.headers).get('X-YV-Native-Origin')).toBe(
      'https://app.yvchat.local',
    )
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
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
      crypto_generation_id: null,
      crypto_epoch: null,
      sequence: 7,
      created_at: '2026-08-11T12:00:01Z',
      expires_at: '2026-09-10T12:00:01Z',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(response),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(new HttpMessagingGateway(new ApiClient()).sendMessage(
      'conversation-1', 'client-1', 1, 'Y2lwaGVydGV4dA==', null, null,
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
          crypto_generation_id: null,
          crypto_epoch: null,
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
        crypto_generation_id: null,
        crypto_epoch: null,
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
