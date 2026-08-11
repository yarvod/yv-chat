import type {
  ClaimedDeviceKeyPackage,
  ClaimDeviceKeyPackageInput,
  DeviceKeyPackageGateway,
} from '../ports/device-key-package-gateway'
import type { DeviceCryptoGateway } from '../ports/device-crypto-gateway'
import { ValidateDeviceKeyPackage } from './validate-device-key-package'

export class ClaimValidatedDeviceKeyPackage {
  private readonly validate: ValidateDeviceKeyPackage

  constructor(
    private readonly packages: DeviceKeyPackageGateway,
    crypto: DeviceCryptoGateway,
  ) {
    this.validate = new ValidateDeviceKeyPackage(crypto)
  }

  async execute(input: ClaimDeviceKeyPackageInput): Promise<ClaimedDeviceKeyPackage> {
    if (!input.conversationId || !input.targetDeviceId || !input.claimRequestId) {
      throw new TypeError('complete KeyPackage claim binding is required')
    }
    return this.validate.execute(await this.packages.claim(input))
  }
}
