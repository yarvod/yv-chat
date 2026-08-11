import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
} from '../ports/device-crypto-gateway'

export class CheckpointDeviceCrypto {
  constructor(private readonly gateway: DeviceCryptoGateway) {}

  execute(): Promise<DeviceCryptoIdentity> {
    return this.gateway.checkpoint()
  }
}
