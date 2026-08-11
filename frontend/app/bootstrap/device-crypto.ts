import { CheckpointDeviceCrypto } from '../application/device-crypto/checkpoint-device-crypto'
import { ProvisionDeviceCrypto } from '../application/device-crypto/provision-device-crypto'
import { RestoreDeviceCrypto } from '../application/device-crypto/restore-device-crypto'
import { CryptoWorkerClient } from '../infrastructure/crypto/crypto-worker-client'

export function createDeviceCryptoScope() {
  const gateway = new CryptoWorkerClient()
  return {
    provision: new ProvisionDeviceCrypto(gateway),
    restore: new RestoreDeviceCrypto(gateway),
    checkpoint: new CheckpointDeviceCrypto(gateway),
    dispose: () => gateway.dispose(),
  }
}
