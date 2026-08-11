import type { DeviceCryptoIdentity } from './device-crypto-gateway'

export interface RegisteredDeviceCryptoIdentity {
  userId: string
  deviceId: string
  protocolVersion: 2
  credentialIdentity: Uint8Array
  signaturePublicKey: Uint8Array
  fingerprint: string
  initialKeyPackageRef: string
  createdAt: string
}

export interface DeviceCryptoRegistryGateway {
  getCurrent(): Promise<RegisteredDeviceCryptoIdentity | null>
  register(identity: DeviceCryptoIdentity): Promise<RegisteredDeviceCryptoIdentity>
}
