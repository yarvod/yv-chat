import {
  ConversationCryptoStateError,
  type ConversationCryptoLocalPhase,
  type ConversationCryptoLocalState,
} from '../../application/ports/conversation-crypto-state-repository'
import type { RandomValues } from './message-archive-codec'
import { validSnapshotKey } from './messenger-snapshot-codec'

export const CONVERSATION_CRYPTO_STATE_SCHEMA_VERSION = 1
const IV_LENGTH = 12
const MAX_SERIALIZED_BYTES = 4_194_304
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface ConversationCryptoStateKeyRecord {
  ownerDeviceId: string
  key: CryptoKey
  createdAt: number
}

export interface EncryptedConversationCryptoStateRecord {
  storageKey: string
  ownerDeviceId: string
  conversationId: string
  schemaVersion: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

interface SerializedState extends Omit<ConversationCryptoLocalState, 'commit' | 'ratchetTree' | 'welcome'> {
  commit: string | null
  ratchetTree: string | null
  welcome: string | null
}

function fail(): never {
  throw new ConversationCryptoStateError('corrupt')
}

function requiredUuid(item: Record<string, unknown>, name: string): string {
  const value = item[name]
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail()
  return value
}

function nullableUuid(item: Record<string, unknown>, name: string): string | null {
  const value = item[name]
  if (value === null) return null
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail()
  return value
}

function nullablePositiveInteger(item: Record<string, unknown>, name: string): number | null {
  const value = item[name]
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail()
  return Number(value)
}

function phase(value: unknown): ConversationCryptoLocalPhase {
  if (
    value !== 'bootstrap-requested'
    && value !== 'coordinator-checkpointed'
    && value !== 'joined'
    && value !== 'ready'
  ) fail()
  return value
}

function decodeBytes(value: unknown): Uint8Array | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0) fail()
  try {
    const binary = atob(value)
    if (binary.length === 0 || btoa(binary) !== value) fail()
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    return fail()
  }
}

function encodeBytes(value: Uint8Array | null): string | null {
  if (value === null) return null
  let binary = ''
  for (let offset = 0; offset < value.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

function parseState(value: unknown): ConversationCryptoLocalState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail()
  const item = value as Record<string, unknown>
  const targetDeviceIds = item.targetDeviceIds
  const updatedAt = item.updatedAt
  if (!Array.isArray(targetDeviceIds) || targetDeviceIds.length > 200) fail()
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) fail()
  return {
    ownerDeviceId: requiredUuid(item, 'ownerDeviceId'),
    conversationId: requiredUuid(item, 'conversationId'),
    bootstrapRequestId: requiredUuid(item, 'bootstrapRequestId'),
    generationId: nullableUuid(item, 'generationId'),
    generationNumber: nullablePositiveInteger(item, 'generationNumber'),
    phase: phase(item.phase),
    epoch: nullablePositiveInteger(item, 'epoch'),
    commit: decodeBytes(item.commit),
    ratchetTree: decodeBytes(item.ratchetTree),
    welcome: decodeBytes(item.welcome),
    targetDeviceIds: targetDeviceIds.map((deviceId) => {
      if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) fail()
      return deviceId
    }),
    updatedAt,
  }
}

export function conversationCryptoStorageKey(ownerDeviceId: string, conversationId: string): string {
  return `${ownerDeviceId}:${conversationId}`
}

export class ConversationCryptoStateCodec {
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
    if (!validSnapshotKey(key)) fail()
    return key
  }

  async seal(
    key: CryptoKey,
    state: ConversationCryptoLocalState,
  ): Promise<EncryptedConversationCryptoStateRecord> {
    const serialized: SerializedState = {
      ...state,
      commit: encodeBytes(state.commit),
      ratchetTree: encodeBytes(state.ratchetTree),
      welcome: encodeBytes(state.welcome),
    }
    const plaintext = this.encoder.encode(JSON.stringify(serialized))
    if (plaintext.byteLength > MAX_SERIALIZED_BYTES) {
      plaintext.fill(0)
      fail()
    }
    const iv = this.randomValues(new Uint8Array(IV_LENGTH))
    try {
      const ciphertext = await this.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: this.aad(state.ownerDeviceId, state.conversationId) },
        key,
        plaintext,
      )
      return {
        storageKey: conversationCryptoStorageKey(state.ownerDeviceId, state.conversationId),
        ownerDeviceId: state.ownerDeviceId,
        conversationId: state.conversationId,
        schemaVersion: CONVERSATION_CRYPTO_STATE_SCHEMA_VERSION,
        iv: iv.slice().buffer,
        ciphertext,
        updatedAt: Date.now(),
      }
    } finally {
      plaintext.fill(0)
    }
  }

  async open(
    key: CryptoKey,
    encrypted: EncryptedConversationCryptoStateRecord,
    ownerDeviceId: string,
    conversationId: string,
  ): Promise<ConversationCryptoLocalState> {
    try {
      if (
        encrypted.storageKey !== conversationCryptoStorageKey(ownerDeviceId, conversationId)
        || encrypted.ownerDeviceId !== ownerDeviceId
        || encrypted.conversationId !== conversationId
        || encrypted.schemaVersion !== CONVERSATION_CRYPTO_STATE_SCHEMA_VERSION
        || encrypted.iv.byteLength !== IV_LENGTH
        || encrypted.ciphertext.byteLength < 16
        || encrypted.ciphertext.byteLength > MAX_SERIALIZED_BYTES + 16
      ) fail()
      const plaintext = new Uint8Array(await this.subtle.decrypt(
        { name: 'AES-GCM', iv: encrypted.iv, additionalData: this.aad(ownerDeviceId, conversationId) },
        key,
        encrypted.ciphertext,
      ))
      try {
        const parsed = parseState(JSON.parse(this.decoder.decode(plaintext)))
        if (parsed.ownerDeviceId !== ownerDeviceId || parsed.conversationId !== conversationId) fail()
        return parsed
      } finally {
        plaintext.fill(0)
      }
    } catch (error) {
      if (error instanceof ConversationCryptoStateError) throw error
      throw new ConversationCryptoStateError('corrupt')
    }
  }

  private aad(ownerDeviceId: string, conversationId: string): ArrayBuffer {
    return this.encoder.encode(
      `yv-chat-conversation-crypto|${CONVERSATION_CRYPTO_STATE_SCHEMA_VERSION}|${ownerDeviceId}|${conversationId}`,
    ).buffer
  }
}
