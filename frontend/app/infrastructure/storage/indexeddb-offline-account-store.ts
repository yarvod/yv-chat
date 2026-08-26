import {
  OfflineAccountStoreError,
  type OfflineAccountStore,
} from '../../application/ports/offline-account-store'
import type { CurrentAccount } from '../../domain/accounts/account'
import { requestResult, transactionDone } from './indexeddb-operations'
import type { RandomValues } from './message-archive-codec'

const DATABASE_NAME = 'yv-chat-offline-account-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'account_keys'
const ACCOUNTS_STORE = 'accounts'
const CURRENT_ID = 'current'
const SCHEMA_VERSION = 1
const IV_BYTES = 12
const MAX_SERIALIZED_BYTES = 4_096
const ADDITIONAL_DATA = new TextEncoder().encode(
  'yv-chat-offline-account-v1:current',
)

interface AccountKeyRecord {
  id: typeof CURRENT_ID
  key: CryptoKey
  createdAt: number
}

interface EncryptedAccountRecord {
  id: typeof CURRENT_ID
  schemaVersion: typeof SCHEMA_VERSION
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

function validKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CryptoKey>
  const algorithm = candidate.algorithm as Partial<AesKeyAlgorithm> | undefined
  return candidate.type === 'secret'
    && candidate.extractable === false
    && algorithm?.name === 'AES-GCM'
    && algorithm.length === 256
    && candidate.usages?.includes('encrypt') === true
    && candidate.usages.includes('decrypt')
}

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new OfflineAccountStoreError('corrupt')
  }
  return value
}

function requiredInstant(value: unknown): string {
  const instant = requiredString(value, 64)
  if (Number.isNaN(Date.parse(instant))) throw new OfflineAccountStoreError('corrupt')
  return instant
}

function parseAccount(value: unknown): CurrentAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OfflineAccountStoreError('corrupt')
  }
  const item = value as Record<string, unknown>
  if (typeof item.isAdmin !== 'boolean') throw new OfflineAccountStoreError('corrupt')
  return {
    userId: requiredString(item.userId, 128),
    deviceId: requiredString(item.deviceId, 128),
    username: requiredString(item.username, 128),
    displayName: requiredString(item.displayName, 256),
    isAdmin: item.isAdmin,
    createdAt: requiredInstant(item.createdAt),
    updatedAt: requiredInstant(item.updatedAt),
  }
}

export class IndexedDbOfflineAccountStore implements OfflineAccountStore {
  private database: Promise<IDBDatabase> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    private readonly subtle: SubtleCrypto = crypto.subtle,
    private readonly randomValues: RandomValues = array => crypto.getRandomValues(array),
  ) {}

  async load(): Promise<CurrentAccount | null> {
    await this.writeQueue.catch(() => undefined)
    try {
      const database = await this.open()
      const transaction = database.transaction([KEYS_STORE, ACCOUNTS_STORE], 'readonly')
      const completed = transactionDone(transaction)
      const [keyRecord, encrypted] = await Promise.all([
        requestResult(transaction.objectStore(KEYS_STORE).get(CURRENT_ID)) as Promise<
          AccountKeyRecord | undefined
        >,
        requestResult(transaction.objectStore(ACCOUNTS_STORE).get(CURRENT_ID)) as Promise<
          EncryptedAccountRecord | undefined
        >,
      ])
      await completed
      if (!encrypted) return null
      if (!keyRecord || keyRecord.id !== CURRENT_ID || !validKey(keyRecord.key)) {
        throw new OfflineAccountStoreError('corrupt')
      }
      if (
        encrypted.id !== CURRENT_ID
        || encrypted.schemaVersion !== SCHEMA_VERSION
        || !(encrypted.iv instanceof ArrayBuffer)
        || encrypted.iv.byteLength !== IV_BYTES
        || !(encrypted.ciphertext instanceof ArrayBuffer)
        || encrypted.ciphertext.byteLength === 0
        || encrypted.ciphertext.byteLength > MAX_SERIALIZED_BYTES + 32
      ) throw new OfflineAccountStoreError('corrupt')
      let plaintext: ArrayBuffer
      try {
        plaintext = await this.subtle.decrypt({
          name: 'AES-GCM',
          iv: encrypted.iv,
          additionalData: ADDITIONAL_DATA,
        }, keyRecord.key, encrypted.ciphertext)
      } catch {
        throw new OfflineAccountStoreError('corrupt')
      }
      if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_SERIALIZED_BYTES) {
        throw new OfflineAccountStoreError('corrupt')
      }
      try {
        return parseAccount(JSON.parse(new TextDecoder().decode(plaintext)))
      } catch (error) {
        if (error instanceof OfflineAccountStoreError) throw error
        throw new OfflineAccountStoreError('corrupt')
      }
    } catch (error) {
      if (error instanceof OfflineAccountStoreError) throw error
      throw new OfflineAccountStoreError('storage-unavailable')
    }
  }

  async save(account: CurrentAccount): Promise<void> {
    const normalized = parseAccount(account)
    const write = () => this.saveNow(normalized)
    const operation = this.writeQueue.then(write, write)
    this.writeQueue = operation
    return operation
  }

  async clear(): Promise<void> {
    const write = async (): Promise<void> => {
      try {
        const database = await this.open()
        const transaction = database.transaction(ACCOUNTS_STORE, 'readwrite')
        const completed = transactionDone(transaction)
        transaction.objectStore(ACCOUNTS_STORE).delete(CURRENT_ID)
        await completed
      } catch (error) {
        if (error instanceof OfflineAccountStoreError) throw error
        throw new OfflineAccountStoreError('storage-unavailable')
      }
    }
    const operation = this.writeQueue.then(write, write)
    this.writeQueue = operation
    return operation
  }

  close(): void {
    if (!this.database) return
    const database = this.database
    this.database = null
    void database.then(value => value.close()).catch(() => undefined)
  }

  private async saveNow(account: CurrentAccount): Promise<void> {
    try {
      const plaintext = new TextEncoder().encode(JSON.stringify(account))
      if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_SERIALIZED_BYTES) {
        throw new OfflineAccountStoreError('corrupt')
      }
      const [database, key] = await Promise.all([this.open(), this.ensureKey()])
      const iv = this.randomValues(new Uint8Array(IV_BYTES))
      const ciphertext = await this.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: ADDITIONAL_DATA,
      }, key, plaintext)
      const transaction = database.transaction(ACCOUNTS_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(ACCOUNTS_STORE).put({
        id: CURRENT_ID,
        schemaVersion: SCHEMA_VERSION,
        iv: iv.slice().buffer,
        ciphertext,
        updatedAt: Date.now(),
      } satisfies EncryptedAccountRecord)
      await completed
    } catch (error) {
      if (error instanceof OfflineAccountStoreError) throw error
      throw new OfflineAccountStoreError('storage-unavailable')
    }
  }

  private async ensureKey(): Promise<CryptoKey> {
    const database = await this.open()
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const existing = await requestResult(
      transaction.objectStore(KEYS_STORE).get(CURRENT_ID),
    ) as AccountKeyRecord | undefined
    await completed
    if (existing) {
      if (existing.id !== CURRENT_ID || !validKey(existing.key)) {
        throw new OfflineAccountStoreError('corrupt')
      }
      return existing.key
    }
    const generated = await this.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    try {
      const write = database.transaction(KEYS_STORE, 'readwrite')
      const writeDone = transactionDone(write)
      write.objectStore(KEYS_STORE).add({
        id: CURRENT_ID,
        key: generated,
        createdAt: Date.now(),
      } satisfies AccountKeyRecord)
      await writeDone
      return generated
    } catch {
      const racedTransaction = database.transaction(KEYS_STORE, 'readonly')
      const racedDone = transactionDone(racedTransaction)
      const raced = await requestResult(
        racedTransaction.objectStore(KEYS_STORE).get(CURRENT_ID),
      ) as AccountKeyRecord | undefined
      await racedDone
      if (raced?.id === CURRENT_ID && validKey(raced.key)) return raced.key
      throw new OfflineAccountStoreError('storage-unavailable')
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      let failed = false
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(KEYS_STORE)) {
          database.createObjectStore(KEYS_STORE, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(ACCOUNTS_STORE)) {
          database.createObjectStore(ACCOUNTS_STORE, { keyPath: 'id' })
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
