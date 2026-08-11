import {
  CryptoVaultError,
  type CryptoVault,
  type CryptoVaultLoadResult,
  type SealedCryptoStateDraft,
  type StoredSealedCryptoState,
} from '../crypto/crypto-vault'
import { requestResult, transactionDone } from './indexeddb-operations'

const DATABASE_NAME = 'yv-chat-crypto-v1'
const DATABASE_VERSION = 2
const WRAPPING_KEYS_STORE = 'wrapping_keys'
const SEALED_STATES_STORE = 'sealed_states'
const MESSAGE_CONTENT_STORE = 'message_content'
const STATE_SCHEMA_VERSION = 1
const IV_LENGTH = 12
const MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024 + 16
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const MAX_MESSAGE_CONTENT_BYTES = 256 * 1024

interface WrappingKeyRecord {
  deviceId: string
  key: CryptoKey
  createdAt: number
}

interface SealedStateRecord {
  deviceId: string
  userId: string
  schemaVersion: number
  revision: number
  fingerprint: string
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

interface EncryptedMessageContentRecord {
  storageKey: string
  deviceId: string
  userId: string
  conversationId: string
  clientMessageId: string
  schemaVersion: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

function validWrappingKey(value: unknown): value is CryptoKey {
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

function validIdentity(userId: string, deviceId: string): boolean {
  return UUID_PATTERN.test(userId) && UUID_PATTERN.test(deviceId)
}

function validDraft(draft: SealedCryptoStateDraft): boolean {
  return Number.isSafeInteger(draft.revision)
    && draft.revision > 0
    && FINGERPRINT_PATTERN.test(draft.fingerprint)
    && draft.iv.byteLength === IV_LENGTH
    && draft.ciphertext.byteLength >= 16
    && draft.ciphertext.byteLength <= MAX_CIPHERTEXT_BYTES
}

function copyBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer
}

function parseState(record: SealedStateRecord): StoredSealedCryptoState {
  const draft: SealedCryptoStateDraft = {
    revision: record.revision,
    fingerprint: record.fingerprint,
    iv: new Uint8Array(record.iv.slice(0)),
    ciphertext: new Uint8Array(record.ciphertext.slice(0)),
  }
  if (
    record.schemaVersion !== STATE_SCHEMA_VERSION
    || !validIdentity(record.userId, record.deviceId)
    || !validDraft(draft)
  ) {
    throw new CryptoVaultError('corrupt')
  }
  return { ...draft, userId: record.userId, deviceId: record.deviceId }
}

export class IndexedDbCryptoVault implements CryptoVault {
  private database: Promise<IDBDatabase> | null = null

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    private readonly subtle: SubtleCrypto = crypto.subtle,
    private readonly randomValues: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>
      = array => crypto.getRandomValues(array),
  ) {}

  async load(userId: string, deviceId: string): Promise<CryptoVaultLoadResult> {
    if (!validIdentity(userId, deviceId)) throw new CryptoVaultError('corrupt')
    try {
      const database = await this.open()
      const transaction = database.transaction(
        [WRAPPING_KEYS_STORE, SEALED_STATES_STORE],
        'readonly',
      )
      const completed = transactionDone(transaction)
      const [keyRecord, stateRecord] = await Promise.all([
        requestResult(transaction.objectStore(WRAPPING_KEYS_STORE).get(deviceId)) as Promise<WrappingKeyRecord | undefined>,
        requestResult(transaction.objectStore(SEALED_STATES_STORE).get(deviceId)) as Promise<SealedStateRecord | undefined>,
      ])
      await completed
      if (!keyRecord && !stateRecord) return { status: 'missing' }
      if (
        !keyRecord
        || !stateRecord
        || keyRecord.deviceId !== deviceId
        || stateRecord.deviceId !== deviceId
        || stateRecord.userId !== userId
        || !validWrappingKey(keyRecord.key)
      ) {
        throw new CryptoVaultError('corrupt')
      }
      return {
        status: 'ready',
        wrappingKey: keyRecord.key,
        state: parseState(stateRecord),
      }
    } catch (error) {
      if (error instanceof CryptoVaultError) throw error
      throw new CryptoVaultError('storage-unavailable')
    }
  }

  async bootstrap(
    userId: string,
    deviceId: string,
    seal: (wrappingKey: CryptoKey) => Promise<SealedCryptoStateDraft>,
  ): Promise<Exclude<CryptoVaultLoadResult, { status: 'missing' }>> {
    const existing = await this.load(userId, deviceId)
    if (existing.status === 'ready') return existing
    let key: CryptoKey
    try {
      key = await this.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    } catch {
      throw new CryptoVaultError('storage-unavailable')
    }
    if (!validWrappingKey(key)) throw new CryptoVaultError('corrupt')
    const draft = await seal(key)
    if (!validDraft(draft)) throw new CryptoVaultError('corrupt')

    try {
      const database = await this.open()
      const transaction = database.transaction(
        [WRAPPING_KEYS_STORE, SEALED_STATES_STORE],
        'readwrite',
      )
      const completed = transactionDone(transaction)
      transaction.objectStore(WRAPPING_KEYS_STORE).add({
        deviceId,
        key,
        createdAt: Date.now(),
      } satisfies WrappingKeyRecord)
      transaction.objectStore(SEALED_STATES_STORE).add(
        this.toRecord(userId, deviceId, draft),
      )
      await completed
      return {
        status: 'ready',
        wrappingKey: key,
        state: { ...draft, userId, deviceId },
      }
    } catch {
      const raced = await this.load(userId, deviceId)
      if (raced.status === 'ready') return raced
      throw new CryptoVaultError('storage-unavailable')
    }
  }

  async update(
    userId: string,
    deviceId: string,
    seal: (wrappingKey: CryptoKey, nextRevision: number) => Promise<SealedCryptoStateDraft>,
  ): Promise<StoredSealedCryptoState> {
    const loaded = await this.load(userId, deviceId)
    if (loaded.status === 'missing') throw new CryptoVaultError('corrupt')
    const nextRevision = loaded.state.revision + 1
    if (!Number.isSafeInteger(nextRevision)) throw new CryptoVaultError('rollback')
    const draft = await seal(loaded.wrappingKey, nextRevision)
    if (!validDraft(draft)) throw new CryptoVaultError('corrupt')
    if (draft.revision !== nextRevision || draft.fingerprint !== loaded.state.fingerprint) {
      throw new CryptoVaultError('rollback')
    }

    try {
      const database = await this.open()
      const transaction = database.transaction(SEALED_STATES_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      const store = transaction.objectStore(SEALED_STATES_STORE)
      const current = await requestResult(store.get(deviceId)) as SealedStateRecord | undefined
      if (!current || current.revision !== loaded.state.revision || current.userId !== userId) {
        transaction.abort()
        await completed.catch(() => undefined)
        throw new CryptoVaultError('conflict')
      }
      store.put(this.toRecord(userId, deviceId, draft))
      await completed
      return { ...draft, userId, deviceId }
    } catch (error) {
      if (error instanceof CryptoVaultError) throw error
      throw new CryptoVaultError('storage-unavailable')
    }
  }

  async loadMessageContent(
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
  ): Promise<Uint8Array | null> {
    if (
      !validIdentity(userId, deviceId)
      || !UUID_PATTERN.test(conversationId)
      || !UUID_PATTERN.test(clientMessageId)
    ) throw new CryptoVaultError('corrupt')
    try {
      const loaded = await this.load(userId, deviceId)
      if (loaded.status === 'missing') throw new CryptoVaultError('corrupt')
      const database = await this.open()
      const transaction = database.transaction(MESSAGE_CONTENT_STORE, 'readonly')
      const completed = transactionDone(transaction)
      const record = await requestResult(
        transaction.objectStore(MESSAGE_CONTENT_STORE).get(
          this.messageStorageKey(deviceId, conversationId, clientMessageId),
        ),
      ) as EncryptedMessageContentRecord | undefined
      await completed
      if (!record) return null
      this.validateMessageRecord(record, userId, deviceId, conversationId, clientMessageId)
      return new Uint8Array(await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: record.iv,
          additionalData: this.messageAad(userId, deviceId, conversationId, clientMessageId),
        },
        loaded.wrappingKey,
        record.ciphertext,
      ))
    } catch (error) {
      if (error instanceof CryptoVaultError) throw error
      throw new CryptoVaultError('storage-unavailable')
    }
  }

  async updateWithMessageContent(
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
    plaintext: Uint8Array,
    seal: (wrappingKey: CryptoKey, nextRevision: number) => Promise<SealedCryptoStateDraft>,
  ): Promise<StoredSealedCryptoState> {
    if (
      !validIdentity(userId, deviceId)
      || !UUID_PATTERN.test(conversationId)
      || !UUID_PATTERN.test(clientMessageId)
      || plaintext.byteLength === 0
      || plaintext.byteLength > MAX_MESSAGE_CONTENT_BYTES
    ) throw new CryptoVaultError('corrupt')
    const loaded = await this.load(userId, deviceId)
    if (loaded.status === 'missing') throw new CryptoVaultError('corrupt')
    const nextRevision = loaded.state.revision + 1
    if (!Number.isSafeInteger(nextRevision)) throw new CryptoVaultError('rollback')
    const [draft, content] = await Promise.all([
      seal(loaded.wrappingKey, nextRevision),
      this.encryptMessageContent(
        loaded.wrappingKey,
        userId,
        deviceId,
        conversationId,
        clientMessageId,
        plaintext,
      ),
    ])
    if (!validDraft(draft)) throw new CryptoVaultError('corrupt')
    if (draft.revision !== nextRevision || draft.fingerprint !== loaded.state.fingerprint) {
      throw new CryptoVaultError('rollback')
    }
    try {
      const database = await this.open()
      const transaction = database.transaction(
        [SEALED_STATES_STORE, MESSAGE_CONTENT_STORE],
        'readwrite',
      )
      const completed = transactionDone(transaction)
      const stateStore = transaction.objectStore(SEALED_STATES_STORE)
      const current = await requestResult(stateStore.get(deviceId)) as SealedStateRecord | undefined
      if (!current || current.revision !== loaded.state.revision || current.userId !== userId) {
        transaction.abort()
        await completed.catch(() => undefined)
        throw new CryptoVaultError('conflict')
      }
      stateStore.put(this.toRecord(userId, deviceId, draft))
      transaction.objectStore(MESSAGE_CONTENT_STORE).put(content)
      await completed
      return { ...draft, userId, deviceId }
    } catch (error) {
      if (error instanceof CryptoVaultError) throw error
      throw new CryptoVaultError('storage-unavailable')
    }
  }

  close(): void {
    if (!this.database) return
    void this.database.then(database => database.close())
    this.database = null
  }

  private toRecord(
    userId: string,
    deviceId: string,
    draft: SealedCryptoStateDraft,
  ): SealedStateRecord {
    return {
      deviceId,
      userId,
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: draft.revision,
      fingerprint: draft.fingerprint,
      iv: copyBuffer(draft.iv),
      ciphertext: copyBuffer(draft.ciphertext),
      updatedAt: Date.now(),
    }
  }

  private async encryptMessageContent(
    key: CryptoKey,
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
    plaintext: Uint8Array,
  ): Promise<EncryptedMessageContentRecord> {
    const iv = this.randomValues(new Uint8Array(IV_LENGTH))
    const ciphertext = await this.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: this.messageAad(userId, deviceId, conversationId, clientMessageId),
      },
      key,
      copyBuffer(plaintext),
    )
    return {
      storageKey: this.messageStorageKey(deviceId, conversationId, clientMessageId),
      deviceId,
      userId,
      conversationId,
      clientMessageId,
      schemaVersion: STATE_SCHEMA_VERSION,
      iv: copyBuffer(iv),
      ciphertext,
      updatedAt: Date.now(),
    }
  }

  private validateMessageRecord(
    record: EncryptedMessageContentRecord,
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
  ): void {
    if (
      record.storageKey !== this.messageStorageKey(deviceId, conversationId, clientMessageId)
      || record.deviceId !== deviceId
      || record.userId !== userId
      || record.conversationId !== conversationId
      || record.clientMessageId !== clientMessageId
      || record.schemaVersion !== STATE_SCHEMA_VERSION
      || record.iv.byteLength !== IV_LENGTH
      || record.ciphertext.byteLength < 17
      || record.ciphertext.byteLength > MAX_MESSAGE_CONTENT_BYTES + 16
    ) throw new CryptoVaultError('corrupt')
  }

  private messageStorageKey(
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
  ): string {
    return `${deviceId}:${conversationId}:${clientMessageId}`
  }

  private messageAad(
    userId: string,
    deviceId: string,
    conversationId: string,
    clientMessageId: string,
  ): ArrayBuffer {
    return new TextEncoder().encode(
      `yv-chat-mls-content|${STATE_SCHEMA_VERSION}|${userId}|${deviceId}|${conversationId}|${clientMessageId}`,
    ).buffer
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(WRAPPING_KEYS_STORE)) {
          database.createObjectStore(WRAPPING_KEYS_STORE, { keyPath: 'deviceId' })
        }
        if (!database.objectStoreNames.contains(SEALED_STATES_STORE)) {
          database.createObjectStore(SEALED_STATES_STORE, { keyPath: 'deviceId' })
        }
        if (!database.objectStoreNames.contains(MESSAGE_CONTENT_STORE)) {
          database.createObjectStore(MESSAGE_CONTENT_STORE, { keyPath: 'storageKey' })
        }
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }
}

export {
  CryptoVaultError,
  type CryptoVaultErrorKind,
  type CryptoVaultLoadResult,
  type SealedCryptoStateDraft,
  type StoredSealedCryptoState,
} from '../crypto/crypto-vault'
