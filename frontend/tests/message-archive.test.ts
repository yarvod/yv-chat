import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpaqueMessage } from '../app/domain/messaging/models'
import {
  IndexedDbMessageArchive,
} from '../app/infrastructure/storage/indexeddb-message-archive'

const ownerUserId = 'user-1'
const conversationId = 'conversation-1'
const databaseName = 'yv-chat-messages-v1'

function message(sequence: number): OpaqueMessage {
  return {
    messageId: `message-${sequence}`,
    clientMessageId: `client-${sequence}`,
    conversationId,
    senderUserId: 'sender-1',
    senderDeviceId: 'device-1',
    protocolVersion: 1,
    sequence,
    createdAt: `2026-08-11T12:00:${String(sequence % 60).padStart(2, '0')}Z`,
    expiresAt: '2026-09-10T12:00:00Z',
    ciphertextBase64: btoa(`private message ${sequence}`),
    cryptoGenerationId: null,
    cryptoEpoch: null,
    deletionReason: null,
    deletedAt: null,
  }
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

let indexedDb: IDBFactory
let archive: IndexedDbMessageArchive

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  indexedDb = new IDBFactory()
  archive = new IndexedDbMessageArchive(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
    100,
  )
})

afterEach(() => {
  archive.close()
  vi.unstubAllGlobals()
})

describe('encrypted IndexedDB message archive', () => {
  it('stores only encrypted transport snapshots under a non-extractable key', async () => {
    const timelineShaped = {
      ...message(1),
      displayBody: 'must never be persisted',
      contentState: 'available',
      contentSecure: false,
    }
    await archive.put(ownerUserId, conversationId, [timelineShaped])
    archive.close()

    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction(['archive_keys', 'messages'], 'readonly')
    const completed = transactionDone(transaction)
    const keyRecord = await requestResult(
      transaction.objectStore('archive_keys').get(ownerUserId),
    ) as { key: CryptoKey }
    const records = await requestResult(
      transaction.objectStore('messages').getAll(),
    ) as Array<{ sequence: number, iv: ArrayBuffer, ciphertext: ArrayBuffer }>
    await completed
    database.close()

    expect(keyRecord.key.extractable).toBe(false)
    await expect(webcrypto.subtle.exportKey(
      'raw',
      keyRecord.key as unknown as webcrypto.CryptoKey,
    )).rejects.toThrow()
    expect(records).toHaveLength(1)
    const encryptedRecord = records[0]
    if (!encryptedRecord) throw new Error('encrypted record is missing')
    const rawCiphertext = new TextDecoder().decode(encryptedRecord.ciphertext)
    expect(rawCiphertext).not.toContain('private message')
    expect(rawCiphertext).not.toContain('must never be persisted')
    const decrypted = await webcrypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encryptedRecord.iv,
        additionalData: new TextEncoder().encode(
          `yv-chat-message-archive|1|${ownerUserId}|${conversationId}|1`,
        ),
      },
      keyRecord.key as unknown as webcrypto.CryptoKey,
      encryptedRecord.ciphertext,
    )
    const serialized = new TextDecoder().decode(decrypted)
    expect(serialized).not.toContain('displayBody')
    expect(serialized).not.toContain('must never be persisted')

    archive = new IndexedDbMessageArchive(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      100,
    )
    await expect(archive.loadLatest(ownerUserId, conversationId, 100))
      .resolves.toEqual([message(1)])
  })

  it('loads stable latest/before pages and keeps the archive bounded', async () => {
    await archive.put(
      ownerUserId,
      conversationId,
      Array.from({ length: 100 }, (_, index) => message(index + 1)),
    )
    await archive.put(
      ownerUserId,
      conversationId,
      Array.from({ length: 5 }, (_, index) => message(index + 101)),
    )

    const latest = await archive.loadLatest(ownerUserId, conversationId, 100)
    const older = await archive.loadBefore(ownerUserId, conversationId, 6, 100)
    const beforeFirst = await archive.loadBefore(ownerUserId, conversationId, 1, 100)
    expect(latest.map(item => item.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => index + 6))
    expect(older).toEqual([])
    expect(beforeFirst).toEqual([])
    await expect(archive.loadLatest('other-user', conversationId, 100)).resolves.toEqual([])
  })

  it('fails closed when encrypted bytes are altered', async () => {
    await archive.put(ownerUserId, conversationId, [message(1)])
    archive.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('messages', 'readwrite')
    const completed = transactionDone(transaction)
    const store = transaction.objectStore('messages')
    const record = await requestResult(
      store.get([ownerUserId, conversationId, 1]),
    ) as { ciphertext: ArrayBuffer }
    const altered = new Uint8Array(record.ciphertext.slice(0))
    altered[0] = (altered[0] ?? 0) ^ 0xff
    store.put({ ...record, ciphertext: altered.buffer })
    await completed
    database.close()

    archive = new IndexedDbMessageArchive(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      100,
    )
    await expect(archive.loadLatest(ownerUserId, conversationId, 100))
      .rejects.toMatchObject({ kind: 'corrupt' })
  })
})
