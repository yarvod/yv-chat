import type {
  DeviceKeyPackageGateway,
  ReplenishedDeviceKeyPackages,
} from '../ports/device-key-package-gateway'

export class ReplenishDeviceKeyPackages {
  constructor(private readonly gateway: DeviceKeyPackageGateway) {}

  execute(keyPackages: readonly Uint8Array[]): Promise<ReplenishedDeviceKeyPackages> {
    if (keyPackages.length === 0 || keyPackages.length > 16) {
      throw new TypeError('between 1 and 16 KeyPackages are required')
    }
    return this.gateway.replenish(keyPackages)
  }
}
