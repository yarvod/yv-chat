const DATABASE_NAME = 'yv-chat-crypto-v1'
const DATABASE_VERSION = 1
const WRAPPING_KEYS_STORE = 'wrapping_keys'
const SEALED_STATES_STORE = 'sealed_states'
const STATE_SCHEMA_VERSION = 1
const IV_LENGTH = 12
const MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024 + 16
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

export type CryptoVaultErrorKind =
  | 'conflict'
  | 'corrupt'
  | 'rollback'
  | 'storage-unavailable'

export class CryptoVaultError extends Error {
  constructor(readonly kind: CryptoVaultErrorKind) {
    super('device crypto vault operation failed')
    this.name = 'CryptoVaultError'
  }
}

export interface SealedCryptoStateDraft {
  revision: number
  fingerprint: string
  iv: Uint8Array
  ciphertext: Uint8Array
}

export interface StoredSealedCryptoState extends SealedCryptoStateDraft {
  userId: string
  deviceId: string
}

export type CryptoVaultLoadResult =
  | { status: 'missing' }
  | {
      status: 'ready'
      wrappingKey: CryptoKey
      state: StoredSealedCryptoState
    }

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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error), { once: true })
  })
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

export class IndexedDbCryptoVault {
  private database: Promise<IDBDatabase> | null = null

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    private readonly subtle: SubtleCrypto = crypto.subtle,
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
      }, { once: true })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database blocked')), { once: true })
    })
    return this.database
  }
}
