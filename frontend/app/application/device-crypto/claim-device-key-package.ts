import type {
  ClaimedDeviceKeyPackage,
  ClaimDeviceKeyPackageInput,
  DeviceKeyPackageGateway,
} from '../ports/device-key-package-gateway'

export class ClaimDeviceKeyPackage {
  constructor(private readonly gateway: DeviceKeyPackageGateway) {}

  execute(input: ClaimDeviceKeyPackageInput): Promise<ClaimedDeviceKeyPackage> {
    if (!input.conversationId || !input.targetDeviceId || !input.claimRequestId) {
      throw new TypeError('conversation, target device, and stable claim request are required')
    }
    return this.gateway.claim(input)
  }
}
