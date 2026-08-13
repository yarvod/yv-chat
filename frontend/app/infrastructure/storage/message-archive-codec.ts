import {
  type ArchivedMessage,
  MessageArchiveError,
} from '../../application/ports/message-archive'

export const ARCHIVE_RECORD_SCHEMA_VERSION = 1
export const ARCHIVE_IV_LENGTH = 12

export interface ArchiveKeyRecord {
  ownerUserId: string
  key: CryptoKey
  createdAt: number
}

export interface EncryptedMessageRecord {
  ownerUserId: string
  conversationId: string
  sequence: number
  schemaVersion: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

export type RandomValues = (
  array: Uint8Array<ArrayBuffer>,
) => Uint8Array<ArrayBuffer>

export function validArchiveKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CryptoKey>
  const algorithm = candidate.algorithm as Partial<AesKeyAlgorithm> | undefined
  const usages = Array.from(candidate.usages ?? [])
  return candidate.type === 'secret'
    && candidate.extractable === false
    && algorithm?.name === 'AES-GCM'
    && algorithm.length === 256
    && usages.length === 2
    && usages.includes('encrypt')
    && usages.includes('decrypt')
}

function additionalData(
  encoder: TextEncoder,
  ownerUserId: string,
  conversationId: string,
  sequence: number,
): ArrayBuffer {
  return encoder.encode(
    `yv-chat-message-archive|${ARCHIVE_RECORD_SCHEMA_VERSION}|${ownerUserId}|${conversationId}|${sequence}`,
  ).buffer
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseMessage(value: unknown): ArchivedMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MessageArchiveError('corrupt')
  }
  const item = value as Record<string, unknown>
  const stringFields = [
    'messageId',
    'clientMessageId',
    'conversationId',
    'senderUserId',
    'senderDeviceId',
    'createdAt',
    'expiresAt',
  ] as const
  if (stringFields.some(name => typeof item[name] !== 'string' || item[name].length === 0)) {
    throw new MessageArchiveError('corrupt')
  }
  if (
    !Number.isSafeInteger(item.protocolVersion)
    || Number(item.protocolVersion) <= 0
    || !Number.isSafeInteger(item.sequence)
    || Number(item.sequence) <= 0
    || !isNullableString(item.ciphertextBase64)
    || !isNullableString(item.deletedAt)
    || (item.deletionReason !== null && item.deletionReason !== 'manual' && item.deletionReason !== 'expired')
  ) {
    throw new MessageArchiveError('corrupt')
  }
  const ciphertextBase64 = item.ciphertextBase64
  const deletedAt = item.deletedAt
  const deletionReason = item.deletionReason as 'manual' | 'expired' | null
  const cryptoGenerationId = item.cryptoGenerationId ?? null
  const cryptoEpoch = item.cryptoEpoch ?? null
  const localPlaintext = item.localPlaintext
  if (
    (ciphertextBase64 !== null && (deletionReason !== null || deletedAt !== null))
    || (ciphertextBase64 === null && (deletionReason === null || deletedAt === null))
    || (cryptoGenerationId !== null && typeof cryptoGenerationId !== 'string')
    || (cryptoEpoch !== null && (
      !Number.isSafeInteger(cryptoEpoch) || Number(cryptoEpoch) <= 0
    ))
    || (Number(item.protocolVersion) === 2) !== (
      cryptoGenerationId !== null && cryptoEpoch !== null
    )
    || (Number(item.protocolVersion) !== 2 && (
      cryptoGenerationId !== null || cryptoEpoch !== null
    ))
    || (localPlaintext !== undefined && (
      typeof localPlaintext !== 'string'
      || localPlaintext.length === 0
      || localPlaintext.length > 32_000
      || ciphertextBase64 === null
    ))
  ) {
    throw new MessageArchiveError('corrupt')
  }
  return {
    messageId: item.messageId as string,
    clientMessageId: item.clientMessageId as string,
    conversationId: item.conversationId as string,
    senderUserId: item.senderUserId as string,
    senderDeviceId: item.senderDeviceId as string,
    protocolVersion: Number(item.protocolVersion),
    cryptoGenerationId,
    cryptoEpoch: cryptoEpoch === null ? null : Number(cryptoEpoch),
    sequence: Number(item.sequence),
    createdAt: item.createdAt as string,
    expiresAt: item.expiresAt as string,
    ciphertextBase64,
    deletionReason,
    deletedAt,
    ...(typeof localPlaintext === 'string' ? { localPlaintext } : {}),
  }
}

function transportSnapshot(message: ArchivedMessage): ArchivedMessage {
  return {
    messageId: message.messageId,
    clientMessageId: message.clientMessageId,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
    protocolVersion: message.protocolVersion,
    cryptoGenerationId: message.cryptoGenerationId,
    cryptoEpoch: message.cryptoEpoch,
    sequence: message.sequence,
    createdAt: message.createdAt,
    expiresAt: message.expiresAt,
    ciphertextBase64: message.ciphertextBase64,
    deletionReason: message.deletionReason,
    deletedAt: message.deletedAt,
    ...(message.localPlaintext ? { localPlaintext: message.localPlaintext } : {}),
  }
}

export class MessageArchiveCodec {
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(
    private readonly subtle: SubtleCrypto,
    private readonly randomValues: RandomValues,
  ) {}

  async generateKey(): Promise<CryptoKey> {
    const key = await this.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    if (!validArchiveKey(key)) throw new MessageArchiveError('corrupt')
    return key
  }

  async seal(
    key: CryptoKey,
    ownerUserId: string,
    conversationId: string,
    message: ArchivedMessage,
  ): Promise<EncryptedMessageRecord> {
    const iv = this.randomValues(new Uint8Array(ARCHIVE_IV_LENGTH))
    const encoded = this.encoder.encode(JSON.stringify(transportSnapshot(message)))
    try {
      const ciphertext = await this.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: additionalData(
            this.encoder,
            ownerUserId,
            conversationId,
            message.sequence,
          ),
        },
        key,
        encoded,
      )
      return {
        ownerUserId,
        conversationId,
        sequence: message.sequence,
        schemaVersion: ARCHIVE_RECORD_SCHEMA_VERSION,
        iv: iv.slice().buffer,
        ciphertext,
        updatedAt: Date.now(),
      }
    } finally {
      encoded.fill(0)
    }
  }

  async open(
    key: CryptoKey,
    record: EncryptedMessageRecord,
    ownerUserId: string,
    conversationId: string,
  ): Promise<ArchivedMessage> {
    try {
      this.validateRecord(record, ownerUserId, conversationId)
      const decryptedBuffer = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: record.iv,
          additionalData: additionalData(
            this.encoder,
            ownerUserId,
            conversationId,
            record.sequence,
          ),
        },
        key,
        record.ciphertext,
      )
      const bytes = new Uint8Array(decryptedBuffer)
      let decoded: unknown
      try {
        decoded = JSON.parse(this.decoder.decode(bytes))
      } finally {
        bytes.fill(0)
      }
      const message = parseMessage(decoded)
      if (message.conversationId !== conversationId || message.sequence !== record.sequence) {
        throw new MessageArchiveError('corrupt')
      }
      return message
    } catch (error) {
      if (error instanceof MessageArchiveError) throw error
      throw new MessageArchiveError('corrupt')
    }
  }

  private validateRecord(
    record: EncryptedMessageRecord,
    ownerUserId: string,
    conversationId: string,
  ): void {
    if (
      record.schemaVersion !== ARCHIVE_RECORD_SCHEMA_VERSION
      || record.ownerUserId !== ownerUserId
      || record.conversationId !== conversationId
      || !Number.isSafeInteger(record.sequence)
      || record.sequence <= 0
      || record.iv.byteLength !== ARCHIVE_IV_LENGTH
      || record.ciphertext.byteLength < 16
    ) {
      throw new MessageArchiveError('corrupt')
    }
  }
}
