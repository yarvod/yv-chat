import {
  MessengerSnapshotStoreError,
  type MessengerSnapshot,
  type MessengerSnapshotStore,
} from '../../application/ports/messenger-snapshot-store'
import { requestResult, transactionDone } from './indexeddb-operations'
import {
  type EncryptedSnapshotRecord,
  MessengerSnapshotCodec,
  type SnapshotKeyRecord,
  validSnapshotKey,
} from './messenger-snapshot-codec'
import type { RandomValues } from './message-archive-codec'

const DATABASE_NAME = 'yv-chat-messenger-snapshot-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'snapshot_keys'
const SNAPSHOTS_STORE = 'snapshots'

export class IndexedDbMessengerSnapshotStore implements MessengerSnapshotStore {
  private database: Promise<IDBDatabase> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly codec: MessengerSnapshotCodec

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    subtle: SubtleCrypto = crypto.subtle,
    randomValues: RandomValues = array => crypto.getRandomValues(array),
  ) {
    this.codec = new MessengerSnapshotCodec(subtle, randomValues)
  }

  async load(ownerUserId: string): Promise<MessengerSnapshot | null> {
    if (!ownerUserId) throw new MessengerSnapshotStoreError('corrupt')
    await this.writeQueue.catch(() => undefined)
    try {
      const database = await this.open()
      const [key, encrypted] = await Promise.all([
        this.loadKey(database, ownerUserId),
        this.loadRecord(database, ownerUserId),
      ])
      if (!key && !encrypted) return null
      if (!key || !encrypted) throw new MessengerSnapshotStoreError('corrupt')
      return await this.codec.open(key, encrypted, ownerUserId)
    } catch (error) {
      if (error instanceof MessengerSnapshotStoreError) throw error
      throw new MessengerSnapshotStoreError('storage-unavailable')
    }
  }

  async save(snapshot: MessengerSnapshot): Promise<void> {
    if (!snapshot.ownerUserId) throw new MessengerSnapshotStoreError('corrupt')
    const write = () => this.saveNow(snapshot)
    const operation = this.writeQueue.then(write, write)
    this.writeQueue = operation
    return operation
  }

  private async saveNow(snapshot: MessengerSnapshot): Promise<void> {
    try {
      const [database, key] = await Promise.all([
        this.open(),
        this.ensureKey(snapshot.ownerUserId),
      ])
      const encrypted = await this.codec.seal(key, snapshot)
      const transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(SNAPSHOTS_STORE).put(encrypted)
      await completed
    } catch (error) {
      if (error instanceof MessengerSnapshotStoreError) throw error
      throw new MessengerSnapshotStoreError('storage-unavailable')
    }
  }

  close(): void {
    if (!this.database) return
    const database = this.database
    this.database = null
    void database.then(value => value.close()).catch(() => undefined)
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
      } satisfies SnapshotKeyRecord)
      await completed
      return generated
    } catch {
      const raced = await this.loadKey(database, ownerUserId)
      if (raced) return raced
      throw new MessengerSnapshotStoreError('storage-unavailable')
    }
  }

  private async loadKey(database: IDBDatabase, ownerUserId: string): Promise<CryptoKey | null> {
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(KEYS_STORE).get(ownerUserId),
    ) as SnapshotKeyRecord | undefined
    await completed
    if (!value) return null
    if (value.ownerUserId !== ownerUserId || !validSnapshotKey(value.key)) {
      throw new MessengerSnapshotStoreError('corrupt')
    }
    return value.key
  }

  private async loadRecord(
    database: IDBDatabase,
    ownerUserId: string,
  ): Promise<EncryptedSnapshotRecord | null> {
    const transaction = database.transaction(SNAPSHOTS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const value = await requestResult(
      transaction.objectStore(SNAPSHOTS_STORE).get(ownerUserId),
    ) as EncryptedSnapshotRecord | undefined
    await completed
    return value ?? null
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      let failed = false
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(KEYS_STORE)) {
          database.createObjectStore(KEYS_STORE, { keyPath: 'ownerUserId' })
        }
        if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
          database.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'ownerUserId' })
        }
      }, { once: true })
      request.addEventListener('success', () => {
        const database = request.result
        if (failed) {
          database.close()
          return
        }
        database.addEventListener('versionchange', () => {
          database.close()
          this.database = null
        }, { once: true })
        resolve(database)
      }, { once: true })
      request.addEventListener('error', () => {
        failed = true
        this.database = null
        reject(request.error)
      }, { once: true })
      request.addEventListener('blocked', () => {
        failed = true
        this.database = null
        reject(new Error('database blocked'))
      }, { once: true })
    })
    return this.database
  }
}
