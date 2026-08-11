import type {
  DeviceKeyPackageGateway,
  DeviceKeyPackageInventory,
} from '../ports/device-key-package-gateway'

export class ListDeviceKeyPackages {
  constructor(private readonly gateway: DeviceKeyPackageGateway) {}

  execute(): Promise<DeviceKeyPackageInventory> {
    return this.gateway.listInventory()
  }
}
