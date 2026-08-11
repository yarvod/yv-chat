import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
} from '../ports/device-crypto-gateway'

export class ProvisionDeviceCrypto {
  constructor(private readonly gateway: DeviceCryptoGateway) {}

  execute(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    return this.gateway.provision(command)
  }
}
