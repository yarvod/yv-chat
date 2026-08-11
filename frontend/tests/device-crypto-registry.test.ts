import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '../app/infrastructure/http/api-client'
import { HttpDeviceCryptoRegistryGateway } from '../app/infrastructure/http/device-crypto-registry-gateway'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const fingerprint = 'ab'.repeat(32)
const packageRef = 'cd'.repeat(32)

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function response(): Record<string, unknown> {
  return {
    user_id: userId,
    device_id: deviceId,
    protocol_version: 2,
    credential_identity_base64: base64(new Uint8Array(33)),
    signature_public_key_base64: base64(new Uint8Array(32)),
    fingerprint,
    initial_key_package_ref: packageRef,
    created_at: '2026-08-11T12:00:00Z',
  }
}

beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    value: '__Host-yv_csrf=csrf-test',
    configurable: true,
  })
})

describe('HTTP device crypto registry gateway', () => {
  it('maps an explicit missing registration without weakening other errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    const gateway = new HttpDeviceCryptoRegistryGateway(new ApiClient())
    await expect(gateway.getCurrent()).resolves.toBeNull()
  })

  it('registers only public bootstrap material and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpDeviceCryptoRegistryGateway(new ApiClient())
    const result = await gateway.register({
      userId,
      deviceId,
      revision: 1,
      fingerprint,
      credentialIdentity: new Uint8Array(33),
      signaturePublicKey: new Uint8Array(32),
      keyPackage: new Uint8Array([1, 2, 3]),
    })

    expect(result).toMatchObject({ userId, deviceId, protocolVersion: 2, fingerprint })
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(setOfKeys(body)).toEqual([
      'credential_identity_base64',
      'key_package_base64',
      'signature_public_key_base64',
    ])
    expect(request.headers).toBeInstanceOf(Headers)
    expect((request.headers as Headers).get('X-CSRF-Token')).toBe('csrf-test')
  })

  it('rejects non-canonical or unexpected public identity data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...response(),
      credential_identity_base64: base64(new Uint8Array(32)),
    }), { status: 200 })))
    const gateway = new HttpDeviceCryptoRegistryGateway(new ApiClient())
    await expect(gateway.getCurrent()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})

function setOfKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort()
}
