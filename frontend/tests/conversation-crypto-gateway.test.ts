import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '../app/infrastructure/http/api-client'
import { HttpConversationCryptoGateway } from '../app/infrastructure/http/conversation-crypto-gateway'

const conversationId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const generationId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const coordinatorDeviceId = 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd'
const coordinatorUserId = '318887ee-2517-45fc-9635-07cf915b31b4'
const memberDeviceId = 'f34b0d48-6dc9-4ed1-9c5b-eb76544ead0a'
const memberUserId = 'd8f16ee6-7063-494e-a71b-558392476527'
const bootstrapRequestId = 'b24a030d-a3f0-4eed-a463-a1722920615c'

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function response(): Record<string, unknown> {
  return {
    generation_id: generationId,
    conversation_id: conversationId,
    generation_number: 1,
    protocol_version: 2,
    status: 'ready',
    block_reason: null,
    coordinator_device_id: coordinatorDeviceId,
    epoch: 2,
    commit_base64: base64(new Uint8Array([1, 2])),
    ratchet_tree_base64: base64(new Uint8Array([3, 4])),
    created_at: '2026-08-11T12:00:00Z',
    updated_at: '2026-08-11T12:01:00Z',
    ready_at: '2026-08-11T12:01:00Z',
    required_devices: [
      requiredDevice(coordinatorUserId, coordinatorDeviceId, true, null),
      requiredDevice(memberUserId, memberDeviceId, false, base64(new Uint8Array([7, 8]))),
    ],
    welcome: {
      target_device_id: memberDeviceId,
      welcome_base64: base64(new Uint8Array([9, 10])),
      created_at: '2026-08-11T12:01:00Z',
      expires_at: '2026-08-12T12:01:00Z',
      acknowledged_at: null,
    },
  }
}

function requiredDevice(
  userId: string,
  deviceId: string,
  isCoordinator: boolean,
  keyPackage: string | null,
): Record<string, unknown> {
  return {
    user_id: userId,
    device_id: deviceId,
    is_coordinator: isCoordinator,
    fingerprint: 'ab'.repeat(32),
    credential_identity_base64: base64(new Uint8Array(33)),
    signature_public_key_base64: base64(new Uint8Array(32)),
    key_package_ref: keyPackage === null ? null : 'cd'.repeat(32),
    key_package_base64: keyPackage,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    value: '__Host-yv_csrf=csrf-test',
    configurable: true,
  })
})

describe('HTTP conversation crypto gateway', () => {
  it('maps a device-targeted ready generation and its opaque MLS bytes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(response())))
    const gateway = new HttpConversationCryptoGateway(new ApiClient())

    const result = await gateway.getCurrent(conversationId)

    expect(result).toMatchObject({
      generationId,
      conversationId,
      generationNumber: 1,
      protocolVersion: 2,
      status: 'ready',
      coordinatorDeviceId,
      epoch: 2,
    })
    expect([...result?.commit ?? []]).toEqual([1, 2])
    expect([...result?.welcome?.welcome ?? []]).toEqual([9, 10])
    expect(result?.requiredDevices).toHaveLength(2)
  })

  it('uses a stable caller-owned request id and serializes finalization exactly', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(response())))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpConversationCryptoGateway(new ApiClient())

    await gateway.begin(conversationId, bootstrapRequestId)
    await gateway.finalize({
      conversationId,
      generationId,
      epoch: 2,
      commit: new Uint8Array([1, 2]),
      ratchetTree: new Uint8Array([3, 4]),
      welcomes: [{ targetDeviceId: memberDeviceId, welcome: new Uint8Array([9, 10]) }],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/conversations/${conversationId}/crypto/bootstrap`,
    )
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      bootstrap_request_id: bootstrapRequestId,
    })
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      epoch: 2,
      commit_base64: 'AQI=',
      ratchet_tree_base64: 'AwQ=',
      welcomes: [{ target_device_id: memberDeviceId, welcome_base64: 'CQo=' }],
    })
  })

  it('acknowledges only the current device welcome and maps explicit absence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpConversationCryptoGateway(new ApiClient())

    await expect(gateway.getCurrent(conversationId)).resolves.toBeNull()
    await expect(gateway.acknowledgeWelcome(conversationId, generationId)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/conversations/${conversationId}/crypto/generations/${generationId}/welcome-ack`,
    )
  })

  it('rejects malformed versions and an unbound coordinator response', async () => {
    const malformed = response()
    malformed.protocol_version = 1
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(malformed)))
    const gateway = new HttpConversationCryptoGateway(new ApiClient())
    await expect(gateway.getCurrent(conversationId))
      .rejects.toMatchObject({ kind: 'invalid-response' })

    const unbound = response()
    unbound.coordinator_device_id = memberDeviceId
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(unbound)))
    await expect(gateway.getCurrent(conversationId))
      .rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
