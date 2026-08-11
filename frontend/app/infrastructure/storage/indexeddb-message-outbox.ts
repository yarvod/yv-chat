import {
  MessageOutboxError,
  type MessageOutbox,
} from '../../application/ports/message-outbox'
import type { OutboxMessage } from '../../domain/messaging/outbox'
import { requestResult, transactionDone } from './indexeddb-operations'
import type { RandomValues } from './message-archive-codec'
import {
  type EncryptedOutboxRecord,
  MessageOutboxCodec,
  type OutboxKeyRecord,
  validOutboxKey,
} from './message-outbox-codec'

const DATABASE_NAME = 'yv-chat-message-outbox-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'outbox_keys'
const MESSAGES_STORE = 'outbox_messages'
const OWNER_INDEX = 'by_owner'
const OWNER_DEVICE_INDEX = 'by_owner_device'
const MAX_MESSAGES_PER_ACCOUNT = 250

function validScope(
  ownerUserId: string,
  senderDeviceId: string,
  clientMessageId?: string,
): boolean {
  return ownerUserId.length > 0
    && senderDeviceId.length > 0
    && (clientMessageId === undefined || clientMessageId.length > 0)
}

export class IndexedDbMessageOutbox implements MessageOutbox {
  private database: Promise<IDBDatabase> | null = null
  private readonly codec: MessageOutboxCodec

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    subtle: SubtleCrypto = crypto.subtle,
    randomValues: RandomValues = array => crypto.getRandomValues(array),
    private readonly maximumMessages = MAX_MESSAGES_PER_ACCOUNT,
  ) {
    if (!Number.isSafeInteger(maximumMessages) || maximumMessages <= 0) {
      throw new MessageOutboxError('corrupt')
    }
    this.codec = new MessageOutboxCodec(subtle, randomValues)
  }

  async enqueue(message: OutboxMessage): Promise<void> {
    if (!validScope(message.ownerUserId, message.senderDeviceId, message.clientMessageId)) {
      throw new MessageOutboxError('corrupt')
    }
    try {
      const [database, key] = await Promise.all([
        this.open(),
        this.ensureKey(message.ownerUserId),
      ])
      const encrypted = await this.codec.seal(key, message)
      await this.addBounded(database, encrypted)
    } catch (error) {
      this.translate(error)
    }
  }

  async get(
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<OutboxMessage | null> {
    if (!validScope(ownerUserId, senderDeviceId, clientMessageId)) {
      throw new MessageOutboxError('corrupt')
    }
    try {
      const database = await this.open()
      const encrypted = await this.loadRecord(
        database,
        ownerUserId,
        senderDeviceId,
        clientMessageId,
      )
      if (!encrypted) return null
      const key = await this.loadKey(database, ownerUserId)
      if (!key) throw new MessageOutboxError('corrupt')
      return await this.codec.open(
        key,
        encrypted,
        ownerUserId,
        senderDeviceId,
        clientMessageId,
      )
    } catch (error) {
      this.translate(error)
    }
  }

  async list(ownerUserId: string, senderDeviceId: string): Promise<OutboxMessage[]> {
    if (!validScope(ownerUserId, senderDeviceId)) throw new MessageOutboxError('corrupt')
    try {
      const database = await this.open()
      const transaction = database.transaction(MESSAGES_STORE, 'readonly')
      const completed = transactionDone(transaction)
      const encrypted = await requestResult(
        transaction.objectStore(MESSAGES_STORE).index(OWNER_DEVICE_INDEX).getAll(
          [ownerUserId, senderDeviceId],
        ),
      ) as EncryptedOutboxRecord[]
      await completed
      if (encrypted.length === 0) return []
      if (encrypted.length > this.maximumMessages) throw new MessageOutboxError('corrupt')
      const key = await this.loadKey(database, ownerUserId)
      if (!key) throw new MessageOutboxError('corrupt')
      const messages = await Promise.all(encrypted.map(record => this.codec.open(
        key,
        record,
        ownerUserId,
        senderDeviceId,
        record.clientMessageId,
      )))
      return messages.sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt)
        || left.clientMessageId.localeCompare(right.clientMessageId)
      ))
    } catch (error) {
      this.translate(error)
    }
  }

  async replace(message: OutboxMessage): Promise<void> {
    if (!validScope(message.ownerUserId, message.senderDeviceId, message.clientMessageId)) {
      throw new MessageOutboxError('corrupt')
    }
    try {
      const database = await this.open()
      const key = await this.loadKey(database, message.ownerUserId)
      if (!key) throw new MessageOutboxError('corrupt')
      const encrypted = await this.codec.seal(key, message)
      await this.replaceExisting(database, encrypted)
    } catch (error) {
      this.translate(error)
    }
  }

  async remove(
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<void> {
    if (!validScope(ownerUserId, senderDeviceId, clientMessageId)) {
      throw new MessageOutboxError('corrupt')
    }
    try {
      const database = await this.open()
      const transaction = database.transaction(MESSAGES_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(MESSAGES_STORE).delete([
        ownerUserId,
        senderDeviceId,
        clientMessageId,
      ])
      await completed
    } catch (error) {
      this.translate(error)
    }
  }

  close(): void {
    if (!this.database) return
    void this.database.then(database => database.close())
    this.database = null
  }

  private async ensureKey(ownerUserId: string): Promise<CryptoKey> {
    const database = await this.open()
    const existing = await this.loadKey(database, ownerUserId)
    if (existing) return existing
    const generated = await this.codec.generateKey()
    try {
      const transaction = database.transaction(KEYS_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(KEYS_STORE).add({
        ownerUserId,
        key: generated,
        createdAt: Date.now(),
      } satisfies OutboxKeyRecord)
      await completed
      return generated
    } catch {
      const raced = await this.loadKey(database, ownerUserId)
      if (raced) return raced
      throw new MessageOutboxError('storage-unavailable')
    }
  }

  private async loadKey(database: IDBDatabase, ownerUserId: string): Promise<CryptoKey | null> {
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(KEYS_STORE).get(ownerUserId),
    ) as OutboxKeyRecord | undefined
    await completed
    if (!record) return null
    if (record.ownerUserId !== ownerUserId || !validOutboxKey(record.key)) {
      throw new MessageOutboxError('corrupt')
    }
    return record.key
  }

  private async loadRecord(
    database: IDBDatabase,
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<EncryptedOutboxRecord | null> {
    const transaction = database.transaction(MESSAGES_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(MESSAGES_STORE).get([
        ownerUserId,
        senderDeviceId,
        clientMessageId,
      ]),
    ) as EncryptedOutboxRecord | undefined
    await completed
    return record ?? null
  }

  private addBounded(
    database: IDBDatabase,
    record: EncryptedOutboxRecord,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MESSAGES_STORE, 'readwrite')
      const store = transaction.objectStore(MESSAGES_STORE)
      let operationError: Error | null = null
      const count = store.index(OWNER_INDEX).count(record.ownerUserId)
      count.addEventListener('success', () => {
        if (count.result >= this.maximumMessages) {
          operationError = new MessageOutboxError('queue-full')
          transaction.abort()
          return
        }
        store.add(record)
      }, { once: true })
      count.addEventListener('error', () => {
        operationError = count.error ?? new Error('outbox count failed')
        transaction.abort()
      }, { once: true })
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener('abort', () => reject(
        operationError ?? transaction.error ?? new Error('outbox enqueue aborted'),
      ), { once: true })
      transaction.addEventListener('error', () => {
        operationError ??= transaction.error ?? new Error('outbox enqueue failed')
      }, { once: true })
    })
  }

  private replaceExisting(
    database: IDBDatabase,
    record: EncryptedOutboxRecord,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MESSAGES_STORE, 'readwrite')
      const store = transaction.objectStore(MESSAGES_STORE)
      let operationError: Error | null = null
      const get = store.get([
        record.ownerUserId,
        record.senderDeviceId,
        record.clientMessageId,
      ])
      get.addEventListener('success', () => {
        if (!get.result) {
          operationError = new MessageOutboxError('corrupt')
          transaction.abort()
          return
        }
        store.put(record)
      }, { once: true })
      get.addEventListener('error', () => {
        operationError = get.error ?? new Error('outbox read failed')
        transaction.abort()
      }, { once: true })
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener('abort', () => reject(
        operationError ?? transaction.error ?? new Error('outbox replace aborted'),
      ), { once: true })
      transaction.addEventListener('error', () => {
        operationError ??= transaction.error ?? new Error('outbox replace failed')
      }, { once: true })
    })
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(KEYS_STORE)) {
          database.createObjectStore(KEYS_STORE, { keyPath: 'ownerUserId' })
        }
        if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
          const store = database.createObjectStore(
            MESSAGES_STORE,
            { keyPath: ['ownerUserId', 'senderDeviceId', 'clientMessageId'] },
          )
          store.createIndex(OWNER_INDEX, 'ownerUserId', { unique: false })
          store.createIndex(
            OWNER_DEVICE_INDEX,
            ['ownerUserId', 'senderDeviceId'],
            { unique: false },
          )
        }
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }

  private translate(error: unknown): never {
    if (error instanceof MessageOutboxError) throw error
    if (error instanceof Error && error.name === 'OperationError') {
      throw new MessageOutboxError('corrupt')
    }
    throw new MessageOutboxError('storage-unavailable')
  }
}
