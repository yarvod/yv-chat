export interface DeviceKeyPackageInventory {
  deviceId: string
  availableCount: number
}

export interface ReplenishedDeviceKeyPackages extends DeviceKeyPackageInventory {
  addedCount: number
}

export interface ClaimDeviceKeyPackageInput {
  conversationId: string
  targetDeviceId: string
  claimRequestId: string
}

export interface ClaimedDeviceKeyPackage {
  conversationId: string
  claimRequestId: string
  targetDeviceId: string
  targetUserId: string
  protocolVersion: 2
  credentialIdentity: Uint8Array
  signaturePublicKey: Uint8Array
  fingerprint: string
  packageRef: string
  keyPackage: Uint8Array
  claimedAt: string
}

export interface DeviceKeyPackageGateway {
  listInventory(): Promise<DeviceKeyPackageInventory>
  replenish(keyPackages: readonly Uint8Array[]): Promise<ReplenishedDeviceKeyPackages>
  claim(input: ClaimDeviceKeyPackageInput): Promise<ClaimedDeviceKeyPackage>
}
