import { DeviceCryptoError } from '../../application/device-crypto/errors'

// A new immutable path is mandatory whenever the generated JS/WASM binding changes.
// v7 adds public local epoch/roster inspection; v1-v6 remain rolling assets.
const MODULE_URL = '/crypto/v7/yv_chat_openmls_provider.js'

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
  generateKeyPackages(count: number): Uint8Array[]
  fingerprint(): string
  createConversation(conversationId: string): bigint
  inspectConversation(conversationId: string): OpenMlsConversationStateOutput | undefined
  addMembersAndMerge(
    conversationId: string,
    serializedKeyPackages: Uint8Array[],
  ): OpenMlsConversationBootstrapOutput
  updateMembersAndMerge(
    conversationId: string,
    desiredDeviceIds: string[],
    serializedKeyPackages: Uint8Array[],
  ): OpenMlsConversationBootstrapOutput
  applyCommitAndMerge(
    conversationId: string,
    commit: Uint8Array,
    desiredDeviceIds: string[],
  ): bigint
  joinConversation(
    conversationId: string,
    welcome: Uint8Array,
    ratchetTree: Uint8Array,
  ): bigint
  rejoinConversation(
    conversationId: string,
    welcome: Uint8Array,
    ratchetTree: Uint8Array,
  ): bigint
  protectApplicationMessage(
    conversationId: string,
    clientMessageId: string,
    plaintext: Uint8Array,
  ): OpenMlsProtectedMessageOutput
  unprotectApplicationMessage(
    conversationId: string,
    clientMessageId: string,
    ciphertext: Uint8Array,
  ): Uint8Array
  sealState(key: CryptoKey, revision: bigint): Promise<OpenMlsSealedSnapshot>
  free(): void
}

export interface OpenMlsConversationStateOutput {
  readonly epoch: bigint
  readonly deviceIds: string[]
  free(): void
}

export interface OpenMlsConversationBootstrapOutput {
  readonly commit: Uint8Array
  readonly welcome: Uint8Array
  readonly ratchetTree: Uint8Array
  readonly epoch: bigint
  free(): void
}

export interface OpenMlsProtectedMessageOutput {
  readonly ciphertext: Uint8Array
  readonly epoch: bigint
  free(): void
}

export interface OpenMlsDeviceBootstrapConstructor {
  readonly prototype: OpenMlsDeviceBootstrap
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
  const prototype = candidate.DeviceBootstrap?.prototype as Partial<OpenMlsDeviceBootstrap> | undefined
  return typeof candidate.default === 'function'
    && typeof candidate.DeviceBootstrap === 'function'
    && typeof candidate.DeviceBootstrap.restoreSealedState === 'function'
    && typeof candidate.validatePublicKeyPackage === 'function'
    && typeof prototype?.createConversation === 'function'
    && typeof prototype.inspectConversation === 'function'
    && typeof prototype.generateKeyPackages === 'function'
    && typeof prototype.addMembersAndMerge === 'function'
    && typeof prototype.updateMembersAndMerge === 'function'
    && typeof prototype.applyCommitAndMerge === 'function'
    && typeof prototype.joinConversation === 'function'
    && typeof prototype.rejoinConversation === 'function'
    && typeof prototype.protectApplicationMessage === 'function'
    && typeof prototype.unprotectApplicationMessage === 'function'
}

type OpenMlsModuleLoader = () => Promise<unknown>

const importVersionedModule: OpenMlsModuleLoader = () => (
  import(/* @vite-ignore */ MODULE_URL)
)

export async function loadOpenMlsModule(
  load: OpenMlsModuleLoader = importVersionedModule,
): Promise<OpenMlsModule> {
  let loaded: unknown
  try {
    loaded = await load()
  } catch {
    throw new DeviceCryptoError('runtime-import-failed')
  }
  if (!isOpenMlsModule(loaded)) {
    throw new DeviceCryptoError('runtime-invalid-module')
  }
  try {
    await loaded.default()
  } catch {
    throw new DeviceCryptoError('runtime-init-failed')
  }
  return loaded
}
