import {
  ConversationCryptoStateError,
  type ConversationCryptoLocalState,
  type ConversationCryptoStateRepository,
} from '../../application/ports/conversation-crypto-state-repository'
import {
  ConversationCryptoStateCodec,
  type ConversationCryptoStateKeyRecord,
  type EncryptedConversationCryptoStateRecord,
  conversationCryptoStorageKey,
} from './conversation-crypto-state-codec'
import type { RandomValues } from './message-archive-codec'
import { validSnapshotKey } from './messenger-snapshot-codec'
import { requestResult, transactionDone } from './indexeddb-operations'

const DATABASE_NAME = 'yv-chat-conversation-crypto-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'device_keys'
const STATES_STORE = 'conversation_states'

export class IndexedDbConversationCryptoState implements ConversationCryptoStateRepository {
  private database: Promise<IDBDatabase> | null = null
  private readonly codec: ConversationCryptoStateCodec

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    subtle: SubtleCrypto = crypto.subtle,
    randomValues: RandomValues = array => crypto.getRandomValues(array),
  ) {
    this.codec = new ConversationCryptoStateCodec(subtle, randomValues)
  }

  async load(
    ownerDeviceId: string,
    conversationId: string,
  ): Promise<ConversationCryptoLocalState | null> {
    try {
      const database = await this.open()
      const [key, encrypted] = await Promise.all([
        this.loadKey(database, ownerDeviceId),
        this.loadRecord(database, ownerDeviceId, conversationId),
      ])
      if (!encrypted) return null
      if (!key) throw new ConversationCryptoStateError('corrupt')
      return await this.codec.open(key, encrypted, ownerDeviceId, conversationId)
    } catch (error) {
      if (error instanceof ConversationCryptoStateError) throw error
      throw new ConversationCryptoStateError('storage-unavailable')
    }
  }

  async save(state: ConversationCryptoLocalState): Promise<void> {
    try {
      const database = await this.open()
      const key = await this.ensureKey(database, state.ownerDeviceId)
      const encrypted = await this.codec.seal(key, state)
      const transaction = database.transaction(STATES_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(STATES_STORE).put(encrypted)
      await completed
    } catch (error) {
      if (error instanceof ConversationCryptoStateError) throw error
      throw new ConversationCryptoStateError('storage-unavailable')
    }
  }

  close(): void {
    if (!this.database) return
    void this.database.then(database => database.close())
    this.database = null
  }

  private async ensureKey(database: IDBDatabase, ownerDeviceId: string): Promise<CryptoKey> {
    const existing = await this.loadKey(database, ownerDeviceId)
    if (existing) return existing
    const generated = await this.codec.generateKey()
    try {
      const transaction = database.transaction(KEYS_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(KEYS_STORE).add({
        ownerDeviceId,
        key: generated,
        createdAt: Date.now(),
      } satisfies ConversationCryptoStateKeyRecord)
      await completed
      return generated
    } catch {
      const raced = await this.loadKey(database, ownerDeviceId)
      if (raced) return raced
      throw new ConversationCryptoStateError('storage-unavailable')
    }
  }

  private async loadKey(database: IDBDatabase, ownerDeviceId: string): Promise<CryptoKey | null> {
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(KEYS_STORE).get(ownerDeviceId),
    ) as ConversationCryptoStateKeyRecord | undefined
    await completed
    if (!value) return null
    if (value.ownerDeviceId !== ownerDeviceId || !validSnapshotKey(value.key)) {
      throw new ConversationCryptoStateError('corrupt')
    }
    return value.key
  }

  private async loadRecord(
    database: IDBDatabase,
    ownerDeviceId: string,
    conversationId: string,
  ): Promise<EncryptedConversationCryptoStateRecord | null> {
    const transaction = database.transaction(STATES_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(STATES_STORE).get(
        conversationCryptoStorageKey(ownerDeviceId, conversationId),
      ),
    ) as EncryptedConversationCryptoStateRecord | undefined
    await completed
    return value ?? null
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(KEYS_STORE)) {
          database.createObjectStore(KEYS_STORE, { keyPath: 'ownerDeviceId' })
        }
        if (!database.objectStoreNames.contains(STATES_STORE)) {
          database.createObjectStore(STATES_STORE, { keyPath: 'storageKey' })
        }
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }
}
