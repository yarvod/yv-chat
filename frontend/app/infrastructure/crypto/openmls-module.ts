import { DeviceCryptoError } from '../../application/device-crypto/errors'

const MODULE_URL = '/crypto/v1/yv_chat_openmls_provider.js'

export interface OpenMlsSealedSnapshot {
  readonly revision: bigint
  readonly fingerprint: string
  readonly iv: Uint8Array
  readonly ciphertext: Uint8Array
  free(): void
}

export interface OpenMlsDeviceBootstrap {
  credentialIdentity(): Uint8Array
  signaturePublicKey(): Uint8Array
  keyPackage(): Uint8Array
  fingerprint(): string
  sealState(key: CryptoKey, revision: bigint): Promise<OpenMlsSealedSnapshot>
  free(): void
}

export interface OpenMlsDeviceBootstrapConstructor {
  new(userId: string, deviceId: string): OpenMlsDeviceBootstrap
  restoreSealedState(
    key: CryptoKey,
    expectedUserId: string,
    expectedDeviceId: string,
    expectedFingerprint: string,
    revision: bigint,
    iv: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<OpenMlsDeviceBootstrap>
}

export interface OpenMlsModule {
  default(moduleOrPath?: URL): Promise<unknown>
  DeviceBootstrap: OpenMlsDeviceBootstrapConstructor
  validatePublicKeyPackage(
    targetUserId: string,
    targetDeviceId: string,
    credentialIdentity: Uint8Array,
    signaturePublicKey: Uint8Array,
    fingerprint: string,
    packageRef: string,
    keyPackage: Uint8Array,
  ): void
}

function isOpenMlsModule(value: unknown): value is OpenMlsModule {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<OpenMlsModule>
  return typeof candidate.default === 'function'
    && typeof candidate.DeviceBootstrap === 'function'
    && typeof candidate.DeviceBootstrap.restoreSealedState === 'function'
    && typeof candidate.validatePublicKeyPackage === 'function'
}

export async function loadOpenMlsModule(): Promise<OpenMlsModule> {
  try {
    const loaded: unknown = await import(/* @vite-ignore */ MODULE_URL)
    if (!isOpenMlsModule(loaded)) throw new DeviceCryptoError('runtime-unavailable')
    await loaded.default()
    return loaded
  } catch (error) {
    if (error instanceof DeviceCryptoError) throw error
    throw new DeviceCryptoError('runtime-unavailable')
  }
}
