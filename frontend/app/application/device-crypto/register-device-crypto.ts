import type { DeviceCryptoIdentity } from '../ports/device-crypto-gateway'
import type {
  DeviceCryptoRegistryGateway,
  RegisteredDeviceCryptoIdentity,
} from '../ports/device-crypto-registry-gateway'

export class RegisterDeviceCrypto {
  constructor(private readonly gateway: DeviceCryptoRegistryGateway) {}

  execute(identity: DeviceCryptoIdentity): Promise<RegisteredDeviceCryptoIdentity> {
    return this.gateway.register(identity)
  }
}
