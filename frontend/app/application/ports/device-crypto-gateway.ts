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

export interface DeviceCryptoGateway {
  provision(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity>
  restore(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity>
  checkpoint(): Promise<DeviceCryptoIdentity>
  dispose(): Promise<void>
}
