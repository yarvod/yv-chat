import {
  MessengerSnapshotStoreError,
  type MessengerSnapshot,
} from '../../application/ports/messenger-snapshot-store'
import type {
  Conversation,
  ConversationMember,
  ConversationReadState,
  DirectoryUser,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'
import type { RandomValues } from './message-archive-codec'

export const SNAPSHOT_SCHEMA_VERSION = 1
const IV_LENGTH = 12
const MAX_SERIALIZED_BYTES = 1_048_576
const MAX_DIRECTORY_USERS = 1_000
const MAX_CONVERSATIONS = 1_000
const MAX_MEMBERS_PER_CONVERSATION = 100
const MAX_RECEIPTS = 5_000

export interface SnapshotKeyRecord {
  ownerUserId: string
  key: CryptoKey
  createdAt: number
}

export interface EncryptedSnapshotRecord {
  ownerUserId: string
  schemaVersion: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

function requiredString(item: Record<string, unknown>, name: string): string {
  const value = item[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return value
}

function nullableString(item: Record<string, unknown>, name: string): string | null {
  const value = item[name]
  if (value !== null && typeof value !== 'string') {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return value
}

function safeSequence(item: Record<string, unknown>, name: string): number {
  const value = item[name]
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return Number(value)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return value as Record<string, unknown>
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return value
}

function parseDirectoryUser(value: unknown): DirectoryUser {
  const item = record(value)
  return {
    userId: requiredString(item, 'userId'),
    username: requiredString(item, 'username'),
    displayName: requiredString(item, 'displayName'),
  }
}

function parseMember(value: unknown): ConversationMember {
  const item = record(value)
  const role = item.role
  if (role !== 'member' && role !== 'admin' && role !== 'owner') {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return {
    ...parseDirectoryUser(item),
    role,
    joinedAt: requiredString(item, 'joinedAt'),
    leftAt: nullableString(item, 'leftAt'),
  }
}

function parseConversation(value: unknown): Conversation {
  const item = record(value)
  const conversationType = item.conversationType
  if (conversationType !== 'direct' && conversationType !== 'group') {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return {
    conversationId: requiredString(item, 'conversationId'),
    conversationType,
    title: nullableString(item, 'title'),
    createdBy: requiredString(item, 'createdBy'),
    createdAt: requiredString(item, 'createdAt'),
    updatedAt: requiredString(item, 'updatedAt'),
    members: array(item.members, MAX_MEMBERS_PER_CONVERSATION).map(parseMember),
  }
}

function parseReadState(value: unknown): ConversationReadState {
  const item = record(value)
  return {
    conversationId: requiredString(item, 'conversationId'),
    lastReadSequence: safeSequence(item, 'lastReadSequence'),
    latestSequence: safeSequence(item, 'latestSequence'),
    unreadCount: safeSequence(item, 'unreadCount'),
  }
}

function parseDeliveryState(value: unknown): ParticipantDeliveryState {
  const item = record(value)
  return {
    conversationId: requiredString(item, 'conversationId'),
    userId: requiredString(item, 'userId'),
    deliveredSequence: safeSequence(item, 'deliveredSequence'),
  }
}

function parseSnapshot(value: unknown, ownerUserId: string): MessengerSnapshot {
  const item = record(value)
  if (requiredString(item, 'ownerUserId') !== ownerUserId) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  const snapshot = {
    ownerUserId,
    directory: array(item.directory, MAX_DIRECTORY_USERS).map(parseDirectoryUser),
    conversations: array(item.conversations, MAX_CONVERSATIONS).map(parseConversation),
    readStates: array(item.readStates, MAX_RECEIPTS).map(parseReadState),
    deliveryStates: array(item.deliveryStates, MAX_RECEIPTS).map(parseDeliveryState),
    syncCursor: safeSequence(item, 'syncCursor'),
    savedAt: requiredString(item, 'savedAt'),
  }
  if (Number.isNaN(Date.parse(snapshot.savedAt))) {
    throw new MessengerSnapshotStoreError('corrupt')
  }
  return snapshot
}

export function validSnapshotKey(value: unknown): value is CryptoKey {
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

export class MessengerSnapshotCodec {
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
    if (!validSnapshotKey(key)) throw new MessengerSnapshotStoreError('corrupt')
    return key
  }

  async seal(key: CryptoKey, snapshot: MessengerSnapshot): Promise<EncryptedSnapshotRecord> {
    const iv = this.randomValues(new Uint8Array(IV_LENGTH))
    const encoded = this.encoder.encode(JSON.stringify(snapshot))
    if (encoded.byteLength > MAX_SERIALIZED_BYTES) {
      encoded.fill(0)
      throw new MessengerSnapshotStoreError('corrupt')
    }
    try {
      const ciphertext = await this.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: this.aad(snapshot.ownerUserId),
        },
        key,
        encoded,
      )
      return {
        ownerUserId: snapshot.ownerUserId,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
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
    encrypted: EncryptedSnapshotRecord,
    ownerUserId: string,
  ): Promise<MessengerSnapshot> {
    try {
      if (
        encrypted.ownerUserId !== ownerUserId
        || encrypted.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
        || encrypted.iv.byteLength !== IV_LENGTH
        || encrypted.ciphertext.byteLength < 16
        || encrypted.ciphertext.byteLength > MAX_SERIALIZED_BYTES + 16
      ) {
        throw new MessengerSnapshotStoreError('corrupt')
      }
      const decrypted = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: encrypted.iv,
          additionalData: this.aad(ownerUserId),
        },
        key,
        encrypted.ciphertext,
      )
      const bytes = new Uint8Array(decrypted)
      try {
        return parseSnapshot(JSON.parse(this.decoder.decode(bytes)), ownerUserId)
      } finally {
        bytes.fill(0)
      }
    } catch (error) {
      if (error instanceof MessengerSnapshotStoreError) throw error
      throw new MessengerSnapshotStoreError('corrupt')
    }
  }

  private aad(ownerUserId: string): ArrayBuffer {
    return this.encoder.encode(
      `yv-chat-messenger-snapshot|${SNAPSHOT_SCHEMA_VERSION}|${ownerUserId}`,
    ).buffer
  }
}
