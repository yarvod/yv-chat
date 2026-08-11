import { MessageOutboxError } from '../../application/ports/message-outbox'
import type { OutboxMessage } from '../../domain/messaging/outbox'
import type { RandomValues } from './message-archive-codec'

export const OUTBOX_SCHEMA_VERSION = 1
const IV_LENGTH = 12
const MAX_SERIALIZED_BYTES = 65_536
const MAX_CIPHERTEXT_BASE64_LENGTH = 48_000

export interface OutboxKeyRecord {
  ownerUserId: string
  key: CryptoKey
  createdAt: number
}

export interface EncryptedOutboxRecord {
  ownerUserId: string
  senderDeviceId: string
  clientMessageId: string
  schemaVersion: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function requiredString(item: Record<string, unknown>, name: string, maximum = 256): string {
  const value = item[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new MessageOutboxError('corrupt')
  }
  return value
}

function validBase64(value: string): boolean {
  return value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
    && !/=/.test(value.slice(0, -2))
}

function parseOutboxMessage(
  value: unknown,
  ownerUserId: string,
  senderDeviceId: string,
  clientMessageId: string,
): OutboxMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MessageOutboxError('corrupt')
  }
  const item = value as Record<string, unknown>
  const status = item.status
  const failureCode = item.failureCode
  const nextAttemptAt = item.nextAttemptAt
  const cryptoGenerationId = item.cryptoGenerationId ?? null
  const cryptoEpoch = item.cryptoEpoch ?? null
  if (
    (status !== 'pending' && status !== 'sending' && status !== 'sent' && status !== 'failed')
    || (failureCode !== null && failureCode !== 'conflict'
      && failureCode !== 'unauthorized' && failureCode !== 'forbidden'
      && failureCode !== 'rejected')
    || (nextAttemptAt !== null && !validDate(nextAttemptAt))
    || !validDate(item.createdAt)
    || !validDate(item.updatedAt)
    || !Number.isSafeInteger(item.protocolVersion)
    || Number(item.protocolVersion) <= 0
    || Number(item.protocolVersion) > 65_535
    || (cryptoGenerationId !== null && (
      typeof cryptoGenerationId !== 'string' || cryptoGenerationId.length > 64
    ))
    || (cryptoEpoch !== null && (
      !Number.isSafeInteger(cryptoEpoch) || Number(cryptoEpoch) <= 0
    ))
    || !Number.isSafeInteger(item.attemptCount)
    || Number(item.attemptCount) < 0
    || Number(item.attemptCount) > 1_000_000
  ) {
    throw new MessageOutboxError('corrupt')
  }
  const parsed: OutboxMessage = {
    ownerUserId: requiredString(item, 'ownerUserId'),
    senderDeviceId: requiredString(item, 'senderDeviceId'),
    clientMessageId: requiredString(item, 'clientMessageId'),
    conversationId: requiredString(item, 'conversationId'),
    protocolVersion: Number(item.protocolVersion),
    ciphertextBase64: requiredString(
      item,
      'ciphertextBase64',
      MAX_CIPHERTEXT_BASE64_LENGTH,
    ),
    cryptoGenerationId,
    cryptoEpoch: cryptoEpoch === null ? null : Number(cryptoEpoch),
    status,
    attemptCount: Number(item.attemptCount),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    nextAttemptAt,
    failureCode,
  }
  if (
    parsed.ownerUserId !== ownerUserId
    || parsed.senderDeviceId !== senderDeviceId
    || parsed.clientMessageId !== clientMessageId
    || (parsed.status === 'failed') !== (parsed.failureCode !== null)
    || (parsed.status !== 'pending' && parsed.nextAttemptAt !== null)
    || !validBase64(parsed.ciphertextBase64)
    || (parsed.protocolVersion === 2) !== (
      parsed.cryptoGenerationId !== null && parsed.cryptoEpoch !== null
    )
    || (parsed.protocolVersion !== 2 && (
      parsed.cryptoGenerationId !== null || parsed.cryptoEpoch !== null
    ))
    || Date.parse(parsed.updatedAt) < Date.parse(parsed.createdAt)
    || (parsed.status !== 'pending' && parsed.attemptCount === 0)
  ) {
    throw new MessageOutboxError('corrupt')
  }
  return parsed
}

export function validOutboxKey(value: unknown): value is CryptoKey {
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

export class MessageOutboxCodec {
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
    if (!validOutboxKey(key)) throw new MessageOutboxError('corrupt')
    return key
  }

  async seal(key: CryptoKey, message: OutboxMessage): Promise<EncryptedOutboxRecord> {
    const validated = parseOutboxMessage(
      message,
      message.ownerUserId,
      message.senderDeviceId,
      message.clientMessageId,
    )
    const encoded = this.encoder.encode(JSON.stringify(validated))
    if (encoded.byteLength > MAX_SERIALIZED_BYTES) {
      encoded.fill(0)
      throw new MessageOutboxError('corrupt')
    }
    const iv = this.randomValues(new Uint8Array(IV_LENGTH))
    try {
      const ciphertext = await this.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: this.aad(
            message.ownerUserId,
            message.senderDeviceId,
            message.clientMessageId,
          ),
        },
        key,
        encoded,
      )
      return {
        ownerUserId: message.ownerUserId,
        senderDeviceId: message.senderDeviceId,
        clientMessageId: message.clientMessageId,
        schemaVersion: OUTBOX_SCHEMA_VERSION,
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
    record: EncryptedOutboxRecord,
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<OutboxMessage> {
    try {
      if (
        record.ownerUserId !== ownerUserId
        || record.senderDeviceId !== senderDeviceId
        || record.clientMessageId !== clientMessageId
        || record.schemaVersion !== OUTBOX_SCHEMA_VERSION
        || record.iv.byteLength !== IV_LENGTH
        || record.ciphertext.byteLength < 16
        || record.ciphertext.byteLength > MAX_SERIALIZED_BYTES + 16
      ) {
        throw new MessageOutboxError('corrupt')
      }
      const decrypted = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: record.iv,
          additionalData: this.aad(ownerUserId, senderDeviceId, clientMessageId),
        },
        key,
        record.ciphertext,
      )
      const bytes = new Uint8Array(decrypted)
      try {
        return parseOutboxMessage(
          JSON.parse(this.decoder.decode(bytes)),
          ownerUserId,
          senderDeviceId,
          clientMessageId,
        )
      } finally {
        bytes.fill(0)
      }
    } catch (error) {
      if (error instanceof MessageOutboxError) throw error
      throw new MessageOutboxError('corrupt')
    }
  }

  private aad(
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): ArrayBuffer {
    return this.encoder.encode(
      `yv-chat-message-outbox|${OUTBOX_SCHEMA_VERSION}|${ownerUserId}|${senderDeviceId}|${clientMessageId}`,
    ).buffer
  }
}
