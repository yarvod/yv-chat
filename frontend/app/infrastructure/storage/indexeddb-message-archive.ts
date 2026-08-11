import type {
  MessageArchive,
} from '../../application/ports/message-archive'
import { MessageArchiveError } from '../../application/ports/message-archive'
import type { OpaqueMessage } from '../../domain/messaging/models'
import { requestResult, transactionDone } from './indexeddb-operations'
import {
  type ArchiveKeyRecord,
  type EncryptedMessageRecord,
  MessageArchiveCodec,
  type RandomValues,
  validArchiveKey,
} from './message-archive-codec'

const DATABASE_NAME = 'yv-chat-messages-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'archive_keys'
const MESSAGES_STORE = 'messages'
const MAX_ARCHIVED_MESSAGES_PER_CONVERSATION = 2_000
const MAX_PAGE_SIZE = 100
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER

function validScope(ownerUserId: string, conversationId: string): boolean {
  return ownerUserId.length > 0 && conversationId.length > 0
}

function validPage(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_PAGE_SIZE
}

function messageKeyRange(ownerUserId: string, conversationId: string, upper: number): IDBKeyRange {
  return IDBKeyRange.bound(
    [ownerUserId, conversationId, 0],
    [ownerUserId, conversationId, upper],
    true,
    false,
  )
}

export class IndexedDbMessageArchive implements MessageArchive {
  private database: Promise<IDBDatabase> | null = null
  private readonly codec: MessageArchiveCodec

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    subtle: SubtleCrypto = crypto.subtle,
    randomValues: RandomValues = array => crypto.getRandomValues(array),
    private readonly maxMessagesPerConversation = MAX_ARCHIVED_MESSAGES_PER_CONVERSATION,
  ) {
    if (
      !Number.isSafeInteger(maxMessagesPerConversation)
      || maxMessagesPerConversation < MAX_PAGE_SIZE
    ) {
      throw new MessageArchiveError('corrupt')
    }
    this.codec = new MessageArchiveCodec(subtle, randomValues)
  }

  async loadLatest(
    ownerUserId: string,
    conversationId: string,
    limit: number,
  ): Promise<OpaqueMessage[]> {
    return this.load(ownerUserId, conversationId, MAX_SEQUENCE, limit)
  }

  async loadBefore(
    ownerUserId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): Promise<OpaqueMessage[]> {
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0) {
      throw new MessageArchiveError('corrupt')
    }
    if (!validScope(ownerUserId, conversationId) || !validPage(limit)) {
      throw new MessageArchiveError('corrupt')
    }
    if (beforeSequence === 1) return []
    return this.load(ownerUserId, conversationId, beforeSequence - 1, limit)
  }

  async put(
    ownerUserId: string,
    conversationId: string,
    messages: readonly OpaqueMessage[],
  ): Promise<void> {
    if (!validScope(ownerUserId, conversationId)) throw new MessageArchiveError('corrupt')
    if (messages.length === 0) return
    if (messages.length > MAX_PAGE_SIZE || messages.some(message => (
      message.conversationId !== conversationId
      || !Number.isSafeInteger(message.sequence)
      || message.sequence <= 0
    ))) {
      throw new MessageArchiveError('corrupt')
    }
    try {
      const [database, key] = await Promise.all([this.open(), this.ensureKey(ownerUserId)])
      const encrypted = await Promise.all(messages.map(message => this.codec.seal(
        key,
        ownerUserId,
        conversationId,
        message,
      )))
      const transaction = database.transaction(MESSAGES_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      const store = transaction.objectStore(MESSAGES_STORE)
      for (const record of encrypted) store.put(record)
      await completed
      await this.prune(ownerUserId, conversationId)
    } catch (error) {
      if (error instanceof MessageArchiveError) throw error
      throw new MessageArchiveError('storage-unavailable')
    }
  }

  close(): void {
    if (!this.database) return
    void this.database.then(database => database.close())
    this.database = null
  }

  private async load(
    ownerUserId: string,
    conversationId: string,
    upperSequence: number,
    limit: number,
  ): Promise<OpaqueMessage[]> {
    if (!validScope(ownerUserId, conversationId) || !validPage(limit)) {
      throw new MessageArchiveError('corrupt')
    }
    try {
      const database = await this.open()
      const key = await this.loadKey(database, ownerUserId)
      if (!key) return []
      const records = await this.readRecords(
        database,
        messageKeyRange(ownerUserId, conversationId, upperSequence),
        limit,
      )
      const messages = await Promise.all(records.map(record => this.codec.open(
        key,
        record,
        ownerUserId,
        conversationId,
      )))
      return messages.reverse()
    } catch (error) {
      if (error instanceof MessageArchiveError) throw error
      if (error instanceof Error && error.name === 'OperationError') {
        throw new MessageArchiveError('corrupt')
      }
      throw new MessageArchiveError('storage-unavailable')
    }
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
      } satisfies ArchiveKeyRecord)
      await completed
      return generated
    } catch {
      const raced = await this.loadKey(database, ownerUserId)
      if (raced) return raced
      throw new MessageArchiveError('storage-unavailable')
    }
  }

  private async loadKey(database: IDBDatabase, ownerUserId: string): Promise<CryptoKey | null> {
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(KEYS_STORE).get(ownerUserId),
    ) as ArchiveKeyRecord | undefined
    await completed
    if (!record) return null
    if (record.ownerUserId !== ownerUserId || !validArchiveKey(record.key)) {
      throw new MessageArchiveError('corrupt')
    }
    return record.key
  }

  private readRecords(
    database: IDBDatabase,
    range: IDBKeyRange,
    limit: number,
  ): Promise<EncryptedMessageRecord[]> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MESSAGES_STORE, 'readonly')
      const records: EncryptedMessageRecord[] = []
      const request = transaction.objectStore(MESSAGES_STORE).openCursor(range, 'prev')
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('success', () => {
        const cursor = request.result
        if (!cursor || records.length >= limit) {
          resolve(records)
          return
        }
        records.push(cursor.value as EncryptedMessageRecord)
        cursor.continue()
      })
    })
  }

  private async prune(ownerUserId: string, conversationId: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(MESSAGES_STORE, 'readwrite')
    const completed = transactionDone(transaction)
    const store = transaction.objectStore(MESSAGES_STORE)
    const request = store.openCursor(
      messageKeyRange(ownerUserId, conversationId, MAX_SEQUENCE),
      'prev',
    )
    let seen = 0
    request.addEventListener('success', () => {
      const cursor = request.result
      if (!cursor) return
      seen += 1
      if (seen > this.maxMessagesPerConversation) cursor.delete()
      cursor.continue()
    })
    await completed
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
          database.createObjectStore(
            MESSAGES_STORE,
            { keyPath: ['ownerUserId', 'conversationId', 'sequence'] },
          )
        }
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }
}
