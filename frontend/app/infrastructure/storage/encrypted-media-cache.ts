import {
  DEFAULT_DEVICE_MEDIA_CACHE_BYTES,
  type MediaCache,
  type MediaCacheScope,
} from '../../application/ports/media-cache'
import { requestResult, transactionDone } from './indexeddb-operations'

const DATABASE_NAME = 'yv-chat-media-cache-v1'
const DATABASE_VERSION = 1
const KEYS_STORE = 'device_keys'
const ENTRIES_STORE = 'entries'
const FALLBACK_BLOBS_STORE = 'fallback_blobs'
const ENTRY_SCHEMA_VERSION = 1
const CHUNK_BYTES = 1024 * 1024
const TAG_BYTES = 16
const NONCE_BYTES = 8
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const OPFS_DIRECTORY = 'yv-chat-media-cache-v1'

type StorageBackend = 'opfs' | 'indexeddb'

interface MediaCacheKeyRecord {
  ownerScopeHash: string
  key: CryptoKey
  createdAt: number
}

interface MediaCacheEntryRecord {
  storageKey: string
  ownerScopeHash: string
  objectName: string
  backend: StorageBackend
  schemaVersion: number
  plaintextByteSize: number
  encryptedByteSize: number
  chunkBytes: number
  chunkCount: number
  nonce: ArrayBuffer
  expiresAt: number
  createdAt: number
  lastAccessedAt: number
}

interface FallbackBlobRecord {
  objectName: string
  encryptedBytes: ArrayBuffer
}

type RandomValues = (
  array: Uint8Array<ArrayBuffer>,
) => Uint8Array<ArrayBuffer>

type OpfsRootProvider = () => Promise<FileSystemDirectoryHandle>

function validKey(value: unknown): value is CryptoKey {
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

function validScope(scope: MediaCacheScope): boolean {
  const expiresAt = Date.parse(scope.expiresAt)
  return scope.ownerUserId.length > 0
    && scope.ownerDeviceId.length > 0
    && scope.conversationId.length > 0
    && scope.attachment.attachmentId.length > 0
    && Number.isSafeInteger(scope.attachment.byteSize)
    && scope.attachment.byteSize > 0
    && scope.attachment.byteSize <= MAX_ATTACHMENT_BYTES
    && Number.isFinite(expiresAt)
}

function validEntry(record: MediaCacheEntryRecord, scopeHash: string, storageKey: string): boolean {
  return record.schemaVersion === ENTRY_SCHEMA_VERSION
    && record.ownerScopeHash === scopeHash
    && record.storageKey === storageKey
    && record.objectName.length === 48
    && (record.backend === 'opfs' || record.backend === 'indexeddb')
    && Number.isSafeInteger(record.plaintextByteSize)
    && record.plaintextByteSize > 0
    && Number.isSafeInteger(record.encryptedByteSize)
    && record.encryptedByteSize > record.plaintextByteSize
    && record.chunkBytes === CHUNK_BYTES
    && record.chunkCount === Math.ceil(record.plaintextByteSize / CHUNK_BYTES)
    && record.encryptedByteSize === record.plaintextByteSize + record.chunkCount * TAG_BYTES
    && record.nonce.byteLength === NONCE_BYTES
    && Number.isFinite(record.expiresAt)
    && Number.isFinite(record.createdAt)
    && Number.isFinite(record.lastAccessedAt)
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function responseContentType(scope: MediaCacheScope): string {
  return scope.attachment.kind === 'file'
    ? 'application/octet-stream'
    : scope.attachment.contentType
}

export class EncryptedMediaCache implements MediaCache {
  private database: Promise<IDBDatabase> | null = null
  private readonly encoder = new TextEncoder()

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    private readonly subtle: SubtleCrypto = crypto.subtle,
    private readonly randomValues: RandomValues = array => crypto.getRandomValues(array),
    private readonly opfsRoot: OpfsRootProvider | null = (
      typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
        ? () => navigator.storage.getDirectory()
        : null
    ),
    private readonly maxBytesPerDevice = DEFAULT_DEVICE_MEDIA_CACHE_BYTES,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isSafeInteger(maxBytesPerDevice) || maxBytesPerDevice <= 0) {
      throw new TypeError('invalid media cache budget')
    }
  }

  async load(scope: MediaCacheScope): Promise<Blob | null> {
    if (!validScope(scope)) throw new TypeError('invalid media cache scope')
    const [ownerScopeHash, storageKey] = await Promise.all([
      this.ownerScopeHash(scope),
      this.storageKey(scope),
    ])
    const database = await this.open()
    const entry = await this.loadEntry(database, storageKey)
    if (!entry) return null
    if (
      !validEntry(entry, ownerScopeHash, storageKey)
      || entry.plaintextByteSize !== scope.attachment.byteSize
      || entry.expiresAt !== Date.parse(scope.expiresAt)
      || entry.expiresAt <= this.now()
    ) {
      await this.removeEntry(entry).catch(() => undefined)
      return null
    }
    const key = await this.loadKey(database, ownerScopeHash)
    if (!key) {
      await this.removeEntry(entry).catch(() => undefined)
      return null
    }
    try {
      const encrypted = await this.readObject(database, entry)
      if (!encrypted || encrypted.size !== entry.encryptedByteSize) {
        await this.removeEntry(entry).catch(() => undefined)
        return null
      }
      const plaintext = await this.decrypt(scope, key, entry, encrypted)
      await this.touch(entry).catch(() => undefined)
      return plaintext
    } catch {
      await this.removeEntry(entry).catch(() => undefined)
      return null
    }
  }

  async store(scope: MediaCacheScope, blob: Blob): Promise<void> {
    if (!validScope(scope) || blob.size !== scope.attachment.byteSize) {
      throw new TypeError('invalid media cache value')
    }
    if (Date.parse(scope.expiresAt) <= this.now()) return
    const [database, ownerScopeHash, storageKey] = await Promise.all([
      this.open(),
      this.ownerScopeHash(scope),
      this.storageKey(scope),
    ])
    const key = await this.ensureKey(database, ownerScopeHash)
    const nonce = this.randomValues(new Uint8Array(NONCE_BYTES))
    const objectName = hex(this.randomValues(new Uint8Array(24)))
    const previous = await this.loadEntry(database, storageKey)
    let persisted: { backend: StorageBackend, encryptedByteSize: number } | null = null
    try {
      persisted = await this.writeObject(database, scope, key, nonce, objectName, blob)
      const timestamp = this.now()
      const entry: MediaCacheEntryRecord = {
        storageKey,
        ownerScopeHash,
        objectName,
        backend: persisted.backend,
        schemaVersion: ENTRY_SCHEMA_VERSION,
        plaintextByteSize: blob.size,
        encryptedByteSize: persisted.encryptedByteSize,
        chunkBytes: CHUNK_BYTES,
        chunkCount: Math.ceil(blob.size / CHUNK_BYTES),
        nonce: nonce.slice().buffer,
        expiresAt: Date.parse(scope.expiresAt),
        createdAt: timestamp,
        lastAccessedAt: timestamp,
      }
      const transaction = database.transaction(ENTRIES_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(ENTRIES_STORE).put(entry)
      await completed
      if (previous && previous.objectName !== objectName) {
        await this.deleteObject(previous).catch(() => undefined)
      }
      await this.prune(ownerScopeHash)
    } catch (error) {
      if (persisted) {
        await this.deleteObject({ objectName, backend: persisted.backend }).catch(() => undefined)
      }
      throw error
    }
  }

  async remove(scope: MediaCacheScope): Promise<void> {
    if (!validScope(scope)) throw new TypeError('invalid media cache scope')
    const database = await this.open()
    const entry = await this.loadEntry(database, await this.storageKey(scope))
    if (entry) await this.removeEntry(entry)
  }

  close(): void {
    if (!this.database) return
    void this.database.then(database => database.close())
    this.database = null
  }

  private async digest(value: string): Promise<string> {
    const digest = await this.subtle.digest('SHA-256', this.encoder.encode(value))
    return hex(new Uint8Array(digest))
  }

  private ownerScopeHash(scope: MediaCacheScope): Promise<string> {
    return this.digest(`yv-chat-media-owner|${scope.ownerUserId}|${scope.ownerDeviceId}`)
  }

  private storageKey(scope: MediaCacheScope): Promise<string> {
    return this.digest(
      `yv-chat-media-entry|${scope.ownerUserId}|${scope.ownerDeviceId}`
      + `|${scope.conversationId}|${scope.attachment.attachmentId}`,
    )
  }

  private additionalData(scope: MediaCacheScope, chunkIndex: number): Uint8Array<ArrayBuffer> {
    return this.encoder.encode(
      `yv-chat-media-cache|${ENTRY_SCHEMA_VERSION}|${scope.ownerUserId}`
      + `|${scope.ownerDeviceId}|${scope.conversationId}|${scope.attachment.attachmentId}`
      + `|${scope.attachment.kind}|${scope.attachment.contentType}`
      + `|${scope.attachment.byteSize}|${scope.expiresAt}|${chunkIndex}`,
    )
  }

  private chunkIv(nonce: Uint8Array, chunkIndex: number): Uint8Array<ArrayBuffer> {
    const iv = new Uint8Array(12)
    iv.set(nonce, 0)
    new DataView(iv.buffer).setUint32(8, chunkIndex, false)
    return iv
  }

  private async generateKey(): Promise<CryptoKey> {
    const key = await this.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    if (!validKey(key)) throw new TypeError('invalid media cache key')
    return key
  }

  private async ensureKey(database: IDBDatabase, ownerScopeHash: string): Promise<CryptoKey> {
    const existing = await this.loadKey(database, ownerScopeHash)
    if (existing) return existing
    const generated = await this.generateKey()
    try {
      const transaction = database.transaction(KEYS_STORE, 'readwrite')
      const completed = transactionDone(transaction)
      transaction.objectStore(KEYS_STORE).add({
        ownerScopeHash,
        key: generated,
        createdAt: this.now(),
      } satisfies MediaCacheKeyRecord)
      await completed
      return generated
    } catch {
      const raced = await this.loadKey(database, ownerScopeHash)
      if (raced) return raced
      throw new TypeError('media cache key unavailable')
    }
  }

  private async loadKey(database: IDBDatabase, ownerScopeHash: string): Promise<CryptoKey | null> {
    const transaction = database.transaction(KEYS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(KEYS_STORE).get(ownerScopeHash),
    ) as MediaCacheKeyRecord | undefined
    await completed
    if (!record) return null
    if (record.ownerScopeHash !== ownerScopeHash || !validKey(record.key)) {
      throw new TypeError('corrupt media cache key')
    }
    return record.key
  }

  private async loadEntry(
    database: IDBDatabase,
    storageKey: string,
  ): Promise<MediaCacheEntryRecord | null> {
    const transaction = database.transaction(ENTRIES_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(ENTRIES_STORE).get(storageKey),
    ) as MediaCacheEntryRecord | undefined
    await completed
    return record ?? null
  }

  private async writeObject(
    database: IDBDatabase,
    scope: MediaCacheScope,
    key: CryptoKey,
    nonce: Uint8Array,
    objectName: string,
    blob: Blob,
  ): Promise<{ backend: StorageBackend, encryptedByteSize: number }> {
    if (this.opfsRoot) {
      try {
        const directory = await this.cacheDirectory()
        const handle = await directory.getFileHandle(objectName, { create: true })
        const writable = await handle.createWritable()
        let encryptedByteSize = 0
        try {
          for (let index = 0, offset = 0; offset < blob.size; index += 1, offset += CHUNK_BYTES) {
            const plaintext = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer()
            const ciphertext = await this.subtle.encrypt({
              name: 'AES-GCM',
              iv: this.chunkIv(nonce, index),
              additionalData: this.additionalData(scope, index),
            }, key, plaintext)
            await writable.write(ciphertext)
            encryptedByteSize += ciphertext.byteLength
          }
          await writable.close()
          return { backend: 'opfs', encryptedByteSize }
        } catch (error) {
          await writable.abort().catch(() => undefined)
          await directory.removeEntry(objectName).catch(() => undefined)
          throw error
        }
      } catch {
        // Unsupported or temporarily unavailable OPFS falls back to this cache's own IDB.
      }
    }
    const parts: BlobPart[] = []
    let encryptedByteSize = 0
    for (let index = 0, offset = 0; offset < blob.size; index += 1, offset += CHUNK_BYTES) {
      const plaintext = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer()
      const ciphertext = await this.subtle.encrypt({
        name: 'AES-GCM',
        iv: this.chunkIv(nonce, index),
        additionalData: this.additionalData(scope, index),
      }, key, plaintext)
      parts.push(ciphertext)
      encryptedByteSize += ciphertext.byteLength
    }
    const encryptedBytes = await new Blob(parts).arrayBuffer()
    const transaction = database.transaction(FALLBACK_BLOBS_STORE, 'readwrite')
    const completed = transactionDone(transaction)
    transaction.objectStore(FALLBACK_BLOBS_STORE).put({
      objectName,
      encryptedBytes,
    } satisfies FallbackBlobRecord)
    await completed
    return { backend: 'indexeddb', encryptedByteSize }
  }

  private async readObject(
    database: IDBDatabase,
    entry: MediaCacheEntryRecord,
  ): Promise<Blob | null> {
    if (entry.backend === 'opfs') {
      const directory = await this.cacheDirectory()
      const handle = await directory.getFileHandle(entry.objectName)
      return await handle.getFile()
    }
    const transaction = database.transaction(FALLBACK_BLOBS_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const record = await requestResult(
      transaction.objectStore(FALLBACK_BLOBS_STORE).get(entry.objectName),
    ) as FallbackBlobRecord | undefined
    await completed
    return record ? new Blob([record.encryptedBytes]) : null
  }

  private async decrypt(
    scope: MediaCacheScope,
    key: CryptoKey,
    entry: MediaCacheEntryRecord,
    encrypted: Blob,
  ): Promise<Blob> {
    const parts: BlobPart[] = []
    let encryptedOffset = 0
    let remaining = entry.plaintextByteSize
    for (let index = 0; index < entry.chunkCount; index += 1) {
      const plaintextBytes = Math.min(CHUNK_BYTES, remaining)
      const encryptedBytes = plaintextBytes + TAG_BYTES
      const chunk = await encrypted.slice(
        encryptedOffset,
        encryptedOffset + encryptedBytes,
      ).arrayBuffer()
      const plaintext = await this.subtle.decrypt({
        name: 'AES-GCM',
        iv: this.chunkIv(new Uint8Array(entry.nonce), index),
        additionalData: this.additionalData(scope, index),
      }, key, chunk)
      if (plaintext.byteLength !== plaintextBytes) throw new TypeError('corrupt media chunk')
      parts.push(plaintext)
      encryptedOffset += encryptedBytes
      remaining -= plaintextBytes
    }
    if (remaining !== 0 || encryptedOffset !== encrypted.size) {
      throw new TypeError('corrupt media size')
    }
    return new Blob(parts, { type: responseContentType(scope) })
  }

  private async touch(entry: MediaCacheEntryRecord): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(ENTRIES_STORE, 'readwrite')
    const completed = transactionDone(transaction)
    const store = transaction.objectStore(ENTRIES_STORE)
    const current = await requestResult(store.get(entry.storageKey)) as MediaCacheEntryRecord | undefined
    if (current?.objectName === entry.objectName) {
      store.put({ ...current, lastAccessedAt: this.now() })
    }
    await completed
  }

  private async prune(ownerScopeHash: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(ENTRIES_STORE, 'readonly')
    const completed = transactionDone(transaction)
    const all = await requestResult(
      transaction.objectStore(ENTRIES_STORE).getAll(),
    ) as MediaCacheEntryRecord[]
    await completed
    const owned = all
      .filter(entry => entry.ownerScopeHash === ownerScopeHash)
      .sort((left, right) => (
        left.lastAccessedAt - right.lastAccessedAt
        || left.storageKey.localeCompare(right.storageKey)
      ))
    let total = owned.reduce((sum, entry) => sum + entry.plaintextByteSize, 0)
    for (const entry of owned) {
      if (entry.expiresAt > this.now() && total <= this.maxBytesPerDevice) continue
      await this.removeEntry(entry)
      total -= entry.plaintextByteSize
    }
  }

  private async removeEntry(entry: MediaCacheEntryRecord): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(ENTRIES_STORE, 'readwrite')
    const completed = transactionDone(transaction)
    transaction.objectStore(ENTRIES_STORE).delete(entry.storageKey)
    await completed
    await this.deleteObject(entry).catch(() => undefined)
  }

  private async deleteObject(entry: Pick<MediaCacheEntryRecord, 'backend' | 'objectName'>): Promise<void> {
    if (entry.backend === 'opfs') {
      const directory = await this.cacheDirectory()
      await directory.removeEntry(entry.objectName)
      return
    }
    const database = await this.open()
    const transaction = database.transaction(FALLBACK_BLOBS_STORE, 'readwrite')
    const completed = transactionDone(transaction)
    transaction.objectStore(FALLBACK_BLOBS_STORE).delete(entry.objectName)
    await completed
  }

  private async cacheDirectory(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsRoot) throw new TypeError('OPFS unavailable')
    const root = await this.opfsRoot()
    return await root.getDirectoryHandle(OPFS_DIRECTORY, { create: true })
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains(KEYS_STORE)) {
          database.createObjectStore(KEYS_STORE, { keyPath: 'ownerScopeHash' })
        }
        if (!database.objectStoreNames.contains(ENTRIES_STORE)) {
          database.createObjectStore(ENTRIES_STORE, { keyPath: 'storageKey' })
        }
        if (!database.objectStoreNames.contains(FALLBACK_BLOBS_STORE)) {
          database.createObjectStore(FALLBACK_BLOBS_STORE, { keyPath: 'objectName' })
        }
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }
}
