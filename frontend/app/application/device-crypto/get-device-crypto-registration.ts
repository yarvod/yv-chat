import type {
  DeviceCryptoRegistryGateway,
  RegisteredDeviceCryptoIdentity,
} from '../ports/device-crypto-registry-gateway'

export class GetDeviceCryptoRegistration {
  constructor(private readonly gateway: DeviceCryptoRegistryGateway) {}

  execute(): Promise<RegisteredDeviceCryptoIdentity | null> {
    return this.gateway.getCurrent()
  }
}
