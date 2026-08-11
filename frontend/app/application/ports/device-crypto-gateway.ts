export interface DeviceCryptoIdentity {
  userId: string
  deviceId: string
  revision: number
  fingerprint: string
  credentialIdentity: Uint8Array
  signaturePublicKey: Uint8Array
  keyPackage: Uint8Array
}

export interface DeviceCryptoIdentityCommand {
  userId: string
  deviceId: string
}

export interface PublicKeyPackageValidationCommand {
  targetUserId: string
  targetDeviceId: string
  credentialIdentity: Uint8Array
  signaturePublicKey: Uint8Array
  fingerprint: string
  packageRef: string
  keyPackage: Uint8Array
}

export interface PublicKeyPackageValidationResult {
  validated: true
}

export interface GenerateDeviceKeyPackagesCommand {
  readonly count: number
}

export interface GeneratedDeviceKeyPackages {
  readonly keyPackages: readonly Uint8Array[]
  readonly revision: number
}

export interface DeviceCryptoGateway {
  provision(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity>
  restore(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity>
  checkpoint(): Promise<DeviceCryptoIdentity>
  validateKeyPackage(
    command: PublicKeyPackageValidationCommand,
  ): Promise<PublicKeyPackageValidationResult>
  generateKeyPackages(
    command: GenerateDeviceKeyPackagesCommand,
  ): Promise<GeneratedDeviceKeyPackages>
  dispose(): Promise<void>
}
