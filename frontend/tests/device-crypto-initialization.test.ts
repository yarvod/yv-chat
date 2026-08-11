import { describe, expect, it, vi } from 'vitest'

import { DeviceCryptoError } from '../app/application/device-crypto/errors'
import { InitializeDeviceCrypto } from '../app/application/device-crypto/initialize-device-crypto'
import { ValidateDeviceKeyPackage } from '../app/application/device-crypto/validate-device-key-package'
import { ClaimValidatedDeviceKeyPackage } from '../app/application/device-crypto/claim-validated-device-key-package'
import type { DeviceCryptoGateway } from '../app/application/ports/device-crypto-gateway'
import type { DeviceCryptoRegistryGateway } from '../app/application/ports/device-crypto-registry-gateway'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const identity = {
  userId,
  deviceId,
  revision: 1,
  fingerprint: 'ab'.repeat(32),
  credentialIdentity: new Uint8Array(33),
  signaturePublicKey: new Uint8Array(32),
  keyPackage: new Uint8Array([1, 2, 3]),
}
const registration = {
  userId,
  deviceId,
  protocolVersion: 2 as const,
  fingerprint: identity.fingerprint,
  credentialIdentity: identity.credentialIdentity,
  signaturePublicKey: identity.signaturePublicKey,
  initialKeyPackageRef: 'cd'.repeat(32),
  createdAt: '2026-08-11T12:00:00Z',
}

function cryptoGateway(): DeviceCryptoGateway {
  return {
    provision: vi.fn().mockResolvedValue(identity),
    restore: vi.fn().mockResolvedValue(identity),
    checkpoint: vi.fn().mockResolvedValue(identity),
    validateKeyPackage: vi.fn().mockResolvedValue({ validated: true }),
    dispose: vi.fn().mockResolvedValue(undefined),
  }
}

function registryGateway(current: typeof registration | null): DeviceCryptoRegistryGateway {
  return {
    getCurrent: vi.fn().mockResolvedValue(current),
    register: vi.fn().mockResolvedValue(registration),
  }
}

describe('authenticated device crypto initialization', () => {
  it('provisions once, registers public state and validates the exact returned binding', async () => {
    const crypto = cryptoGateway()
    const registry = registryGateway(null)
    const result = await new InitializeDeviceCrypto(crypto, registry).execute({ userId, deviceId })

    expect(result).toEqual({ identity, registration })
    expect(crypto.provision).toHaveBeenCalledWith({ userId, deviceId })
    expect(crypto.restore).not.toHaveBeenCalled()
    expect(registry.register).toHaveBeenCalledWith(identity)
    expect(crypto.validateKeyPackage).toHaveBeenCalledWith({
      targetUserId: userId,
      targetDeviceId: deviceId,
      credentialIdentity: registration.credentialIdentity,
      signaturePublicKey: registration.signaturePublicKey,
      fingerprint: registration.fingerprint,
      packageRef: registration.initialKeyPackageRef,
      keyPackage: identity.keyPackage,
    })
  })

  it('restores registered state and never silently generates a replacement identity', async () => {
    const crypto = cryptoGateway()
    const registry = registryGateway(registration)
    await new InitializeDeviceCrypto(crypto, registry).execute({ userId, deviceId })
    expect(crypto.restore).toHaveBeenCalledWith({ userId, deviceId })
    expect(crypto.provision).not.toHaveBeenCalled()
    expect(registry.register).not.toHaveBeenCalled()

    vi.mocked(crypto.restore).mockRejectedValue(new DeviceCryptoError('not-provisioned'))
    await expect(new InitializeDeviceCrypto(crypto, registry).execute({ userId, deviceId }))
      .rejects.toMatchObject({ code: 'not-provisioned' })
    expect(crypto.provision).not.toHaveBeenCalled()
  })

  it('fails closed when server registration differs from local public identity', async () => {
    const crypto = cryptoGateway()
    const registry = registryGateway({ ...registration, fingerprint: 'ef'.repeat(32) })
    await expect(new InitializeDeviceCrypto(crypto, registry).execute({ userId, deviceId }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(crypto.validateKeyPackage).not.toHaveBeenCalled()
  })

  it('validates a claimed package before returning it to group orchestration', async () => {
    const crypto = cryptoGateway()
    const claimed = {
      conversationId: userId,
      claimRequestId: '318887ee-2517-45fc-9635-07cf915b31b4',
      targetDeviceId: deviceId,
      targetUserId: userId,
      protocolVersion: 2 as const,
      credentialIdentity: identity.credentialIdentity,
      signaturePublicKey: identity.signaturePublicKey,
      fingerprint: identity.fingerprint,
      packageRef: registration.initialKeyPackageRef,
      keyPackage: identity.keyPackage,
      claimedAt: registration.createdAt,
    }
    await expect(new ValidateDeviceKeyPackage(crypto).execute(claimed)).resolves.toBe(claimed)
    expect(crypto.validateKeyPackage).toHaveBeenCalledWith(expect.objectContaining({
      targetDeviceId: deviceId,
      packageRef: registration.initialKeyPackageRef,
    }))

    const packages = { listInventory: vi.fn(), replenish: vi.fn(), claim: vi.fn().mockResolvedValue(claimed) }
    await expect(new ClaimValidatedDeviceKeyPackage(packages, crypto).execute({
      conversationId: claimed.conversationId,
      targetDeviceId: claimed.targetDeviceId,
      claimRequestId: claimed.claimRequestId,
    })).resolves.toBe(claimed)
    expect(packages.claim).toHaveBeenCalledOnce()
  })
})
