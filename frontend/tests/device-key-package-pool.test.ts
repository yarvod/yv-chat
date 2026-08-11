import { describe, expect, it, vi } from 'vitest'

import { EnsureDeviceKeyPackagePool } from '../app/application/device-crypto/ensure-key-package-pool'
import type { DeviceCryptoGateway } from '../app/application/ports/device-crypto-gateway'
import type { DeviceKeyPackageGateway } from '../app/application/ports/device-key-package-gateway'

const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'

function cryptoGateway(): DeviceCryptoGateway {
  return {
    provision: vi.fn(),
    restore: vi.fn(),
    checkpoint: vi.fn(),
    validateKeyPackage: vi.fn(),
    generateKeyPackages: vi.fn(async ({ count }) => ({
      keyPackages: Array.from({ length: count }, (_, index) => new Uint8Array([index + 1])),
      revision: 4,
    })),
    dispose: vi.fn(),
  }
}

describe('automatic device KeyPackage pool', () => {
  it('generates and uploads only the number missing from the foreground target', async () => {
    const crypto = cryptoGateway()
    const server: DeviceKeyPackageGateway = {
      listInventory: vi.fn(async () => ({ deviceId, availableCount: 3 })),
      replenish: vi.fn(async packages => ({
        deviceId,
        addedCount: packages.length,
        availableCount: 8,
      })),
      claim: vi.fn(),
    }

    await expect(new EnsureDeviceKeyPackagePool(server, crypto).execute(deviceId))
      .resolves.toEqual({ availableCount: 8, generatedCount: 5, revision: 4 })
    expect(crypto.generateKeyPackages).toHaveBeenCalledWith({ count: 5 })
    expect(server.replenish).toHaveBeenCalledWith([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
      new Uint8Array([4]),
      new Uint8Array([5]),
    ])
  })

  it('does not mutate provider state when the inventory is already sufficient', async () => {
    const crypto = cryptoGateway()
    const server: DeviceKeyPackageGateway = {
      listInventory: vi.fn(async () => ({ deviceId, availableCount: 9 })),
      replenish: vi.fn(),
      claim: vi.fn(),
    }
    await expect(new EnsureDeviceKeyPackagePool(server, crypto).execute(deviceId))
      .resolves.toEqual({ availableCount: 9, generatedCount: 0, revision: null })
    expect(crypto.generateKeyPackages).not.toHaveBeenCalled()
    expect(server.replenish).not.toHaveBeenCalled()
  })

  it('fails closed on a response bound to another device', async () => {
    const server: DeviceKeyPackageGateway = {
      listInventory: vi.fn(async () => ({
        deviceId: 'd44483ee-2c69-4eef-aeba-5ce92bc9181d',
        availableCount: 8,
      })),
      replenish: vi.fn(),
      claim: vi.fn(),
    }
    await expect(new EnsureDeviceKeyPackagePool(server, cryptoGateway()).execute(deviceId))
      .rejects.toMatchObject({ code: 'conflict' })
  })
})
