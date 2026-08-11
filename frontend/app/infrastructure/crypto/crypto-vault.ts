export type CryptoVaultErrorKind =
  | 'conflict'
  | 'corrupt'
  | 'rollback'
  | 'storage-unavailable'

export class CryptoVaultError extends Error {
  constructor(readonly kind: CryptoVaultErrorKind) {
    super('device crypto vault operation failed')
    this.name = 'CryptoVaultError'
  }
}

export interface SealedCryptoStateDraft {
  revision: number
  fingerprint: string
  iv: Uint8Array
  ciphertext: Uint8Array
}

export interface StoredSealedCryptoState extends SealedCryptoStateDraft {
  userId: string
  deviceId: string
}

export interface CryptoVaultReady {
  status: 'ready'
  wrappingKey: CryptoKey
  state: StoredSealedCryptoState
}

export type CryptoVaultLoadResult = { status: 'missing' } | CryptoVaultReady

export interface CryptoVault {
  load(userId: string, deviceId: string): Promise<CryptoVaultLoadResult>
  bootstrap(
    userId: string,
    deviceId: string,
    seal: (wrappingKey: CryptoKey) => Promise<SealedCryptoStateDraft>,
  ): Promise<CryptoVaultReady>
  update(
    userId: string,
    deviceId: string,
    seal: (
      wrappingKey: CryptoKey,
      nextRevision: number,
    ) => Promise<SealedCryptoStateDraft>,
  ): Promise<StoredSealedCryptoState>
  loadMessageContent(
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
  ): Promise<Uint8Array | null>
  updateWithMessageContent(
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
    plaintext: Uint8Array,
    seal: (
      wrappingKey: CryptoKey,
      nextRevision: number,
    ) => Promise<SealedCryptoStateDraft>,
  ): Promise<StoredSealedCryptoState>
  close(): void
}
