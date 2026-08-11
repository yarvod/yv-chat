import { CheckpointDeviceCrypto } from '../application/device-crypto/checkpoint-device-crypto'
import { ClaimValidatedDeviceKeyPackage } from '../application/device-crypto/claim-validated-device-key-package'
import { InitializeDeviceCrypto } from '../application/device-crypto/initialize-device-crypto'
import { ProvisionDeviceCrypto } from '../application/device-crypto/provision-device-crypto'
import { RestoreDeviceCrypto } from '../application/device-crypto/restore-device-crypto'
import { ValidateDeviceKeyPackage } from '../application/device-crypto/validate-device-key-package'
import type { DeviceCryptoRegistryGateway } from '../application/ports/device-crypto-registry-gateway'
import type { DeviceKeyPackageGateway } from '../application/ports/device-key-package-gateway'
import { CryptoWorkerClient } from '../infrastructure/crypto/crypto-worker-client'

export function createDeviceCryptoScope(
  registry: DeviceCryptoRegistryGateway,
  packages: DeviceKeyPackageGateway,
) {
  const gateway = new CryptoWorkerClient()
  return {
    initialize: new InitializeDeviceCrypto(gateway, registry),
    provision: new ProvisionDeviceCrypto(gateway),
    restore: new RestoreDeviceCrypto(gateway),
    checkpoint: new CheckpointDeviceCrypto(gateway),
    validateKeyPackage: new ValidateDeviceKeyPackage(gateway),
    claimKeyPackage: new ClaimValidatedDeviceKeyPackage(packages, gateway),
    dispose: () => gateway.dispose(),
  }
}
