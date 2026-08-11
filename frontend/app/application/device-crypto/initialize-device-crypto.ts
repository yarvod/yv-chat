import { DeviceCryptoError } from './errors'
import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
} from '../ports/device-crypto-gateway'
import type {
  DeviceCryptoRegistryGateway,
  RegisteredDeviceCryptoIdentity,
} from '../ports/device-crypto-registry-gateway'

export interface InitializedDeviceCrypto {
  identity: DeviceCryptoIdentity
  registration: RegisteredDeviceCryptoIdentity
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

export class InitializeDeviceCrypto {
  constructor(
    private readonly crypto: DeviceCryptoGateway,
    private readonly registry: DeviceCryptoRegistryGateway,
  ) {}

  async execute(command: DeviceCryptoIdentityCommand): Promise<InitializedDeviceCrypto> {
    const existing = await this.registry.getCurrent()
    const identity = existing
      ? await this.crypto.restore(command)
      : await this.crypto.provision(command)
    const registration = existing ?? await this.registry.register(identity)

    if (
      registration.userId !== identity.userId
      || registration.deviceId !== identity.deviceId
      || registration.fingerprint !== identity.fingerprint
      || !equalBytes(registration.credentialIdentity, identity.credentialIdentity)
      || !equalBytes(registration.signaturePublicKey, identity.signaturePublicKey)
    ) throw new DeviceCryptoError('conflict')

    await this.crypto.validateKeyPackage({
      targetUserId: registration.userId,
      targetDeviceId: registration.deviceId,
      credentialIdentity: registration.credentialIdentity,
      signaturePublicKey: registration.signaturePublicKey,
      fingerprint: registration.fingerprint,
      packageRef: registration.initialKeyPackageRef,
      keyPackage: identity.keyPackage,
    })
    return { identity, registration }
  }
}
