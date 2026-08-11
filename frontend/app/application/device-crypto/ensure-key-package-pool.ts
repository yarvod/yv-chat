import { DeviceCryptoError } from './errors'
import type { DeviceCryptoGateway } from '../ports/device-crypto-gateway'
import type { DeviceKeyPackageGateway } from '../ports/device-key-package-gateway'

const TARGET_AVAILABLE_PACKAGES = 8

export interface EnsuredDeviceKeyPackagePool {
  readonly availableCount: number
  readonly generatedCount: number
  readonly revision: number | null
}

export class EnsureDeviceKeyPackagePool {
  constructor(
    private readonly server: DeviceKeyPackageGateway,
    private readonly crypto: DeviceCryptoGateway,
  ) {}

  async execute(deviceId: string): Promise<EnsuredDeviceKeyPackagePool> {
    const inventory = await this.server.listInventory()
    if (inventory.deviceId !== deviceId) throw new DeviceCryptoError('conflict')
    const missing = Math.max(0, TARGET_AVAILABLE_PACKAGES - inventory.availableCount)
    if (missing === 0) {
      return { availableCount: inventory.availableCount, generatedCount: 0, revision: null }
    }
    const generated = await this.crypto.generateKeyPackages({ count: missing })
    const replenished = await this.server.replenish(generated.keyPackages)
    if (
      replenished.deviceId !== deviceId
      || replenished.addedCount !== missing
      || replenished.availableCount < TARGET_AVAILABLE_PACKAGES
    ) throw new DeviceCryptoError('conflict')
    return {
      availableCount: replenished.availableCount,
      generatedCount: missing,
      revision: generated.revision,
    }
  }
}
