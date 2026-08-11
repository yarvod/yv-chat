import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
} from '../ports/device-crypto-gateway'

export class RestoreDeviceCrypto {
  constructor(private readonly gateway: DeviceCryptoGateway) {}

  execute(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    return this.gateway.restore(command)
  }
}
