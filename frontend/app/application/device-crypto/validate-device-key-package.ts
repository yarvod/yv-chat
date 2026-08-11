import type { ClaimedDeviceKeyPackage } from '../ports/device-key-package-gateway'
import type { DeviceCryptoGateway } from '../ports/device-crypto-gateway'

export class ValidateDeviceKeyPackage {
  constructor(private readonly crypto: DeviceCryptoGateway) {}

  async execute(claimed: ClaimedDeviceKeyPackage): Promise<ClaimedDeviceKeyPackage> {
    await this.crypto.validateKeyPackage({
      targetUserId: claimed.targetUserId,
      targetDeviceId: claimed.targetDeviceId,
      credentialIdentity: claimed.credentialIdentity,
      signaturePublicKey: claimed.signaturePublicKey,
      fingerprint: claimed.fingerprint,
      packageRef: claimed.packageRef,
      keyPackage: claimed.keyPackage,
    })
    return claimed
  }
}
