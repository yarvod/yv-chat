import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaimDeviceKeyPackage } from '../app/application/device-crypto/claim-device-key-package'
import { ReplenishDeviceKeyPackages } from '../app/application/device-crypto/replenish-device-key-packages'
import { ApiClient } from '../app/infrastructure/http/api-client'
import { HttpDeviceKeyPackageGateway } from '../app/infrastructure/http/device-key-package-gateway'

const conversationId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const targetDeviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const targetUserId = 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd'
const claimRequestId = '318887ee-2517-45fc-9635-07cf915b31b4'
const fingerprint = 'ab'.repeat(32)
const packageRef = 'cd'.repeat(32)

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    value: '__Host-yv_csrf=csrf-test',
    configurable: true,
  })
})

describe('HTTP device KeyPackage gateway', () => {
  it('lists and replenishes the current device pool with public bytes only', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ device_id: targetDeviceId, available_count: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        device_id: targetDeviceId,
        available_count: 4,
        added_count: 2,
      }))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpDeviceKeyPackageGateway(new ApiClient())

    await expect(gateway.listInventory()).resolves.toEqual({
      deviceId: targetDeviceId,
      availableCount: 2,
    })
    await expect(new ReplenishDeviceKeyPackages(gateway).execute([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ])).resolves.toMatchObject({ addedCount: 2, availableCount: 4 })

    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({
      key_packages_base64: ['AQI=', 'AwQ='],
    })
    expect((request.headers as Headers).get('X-CSRF-Token')).toBe('csrf-test')
  })

  it('claims with a caller-owned stable request id and validates public identity binding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(claimResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const useCase = new ClaimDeviceKeyPackage(
      new HttpDeviceKeyPackageGateway(new ApiClient()),
    )

    const result = await useCase.execute({ conversationId, targetDeviceId, claimRequestId })
    expect(result).toMatchObject({
      conversationId,
      claimRequestId,
      targetDeviceId,
      targetUserId,
      protocolVersion: 2,
      fingerprint,
      packageRef,
    })
    expect([...result.keyPackage]).toEqual([7, 8, 9])
    const [path, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe(`/api/v1/conversations/${conversationId}/key-package-claims`)
    expect(JSON.parse(String(request.body))).toEqual({
      target_device_id: targetDeviceId,
      claim_request_id: claimRequestId,
    })
  })

  it('rejects a malformed claim identity binding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      ...claimResponse(),
      target_device_id: 'not-a-uuid',
    })))
    const gateway = new HttpDeviceKeyPackageGateway(new ApiClient())
    await expect(gateway.claim({ conversationId, targetDeviceId, claimRequestId }))
      .rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('refuses empty replenishment and incomplete claim commands before transport', async () => {
    const gateway = new HttpDeviceKeyPackageGateway(new ApiClient())
    expect(() => new ReplenishDeviceKeyPackages(gateway).execute([])).toThrow(TypeError)
    expect(() => new ClaimDeviceKeyPackage(gateway).execute({
      conversationId: '',
      targetDeviceId,
      claimRequestId,
    })).toThrow(TypeError)
  })
})

function claimResponse(): Record<string, unknown> {
  return {
    conversation_id: conversationId,
    claim_request_id: claimRequestId,
    target_device_id: targetDeviceId,
    target_user_id: targetUserId,
    protocol_version: 2,
    credential_identity_base64: base64(new Uint8Array(33)),
    signature_public_key_base64: base64(new Uint8Array(32)),
    fingerprint,
    package_ref: packageRef,
    key_package_base64: base64(new Uint8Array([7, 8, 9])),
    claimed_at: '2026-08-11T12:00:00Z',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
