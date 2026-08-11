import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OutboxMessage } from '../app/domain/messaging/outbox'
import { IndexedDbMessageOutbox } from '../app/infrastructure/storage/indexeddb-message-outbox'

const ownerUserId = 'user-1'
const senderDeviceId = 'device-1'
const databaseName = 'yv-chat-message-outbox-v1'

const pending: OutboxMessage = {
  ownerUserId,
  senderDeviceId,
  clientMessageId: 'client-1',
  conversationId: 'conversation-1',
  protocolVersion: 1,
  ciphertextBase64: 'UHJpdmF0ZSBvZmZsaW5lIG1lc3NhZ2U=',
  status: 'pending',
  attemptCount: 0,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  nextAttemptAt: null,
  failureCode: null,
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
let store: IndexedDbMessageOutbox

function createStore(maximumMessages = 250): IndexedDbMessageOutbox {
  return new IndexedDbMessageOutbox(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
    maximumMessages,
  )
}

beforeEach(() => {
  indexedDb = new IDBFactory()
  store = createStore()
})

afterEach(() => store.close())

describe('encrypted message outbox', () => {
  it('round-trips transitions without exposing payload or an extractable key', async () => {
    await store.enqueue(pending)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction(['outbox_keys', 'outbox_messages'], 'readonly')
    const completed = transactionDone(transaction)
    const keyRecord = await requestResult(
      transaction.objectStore('outbox_keys').get(ownerUserId),
    ) as { key: CryptoKey }
    const encrypted = await requestResult(
      transaction.objectStore('outbox_messages').get([
        ownerUserId,
        senderDeviceId,
        'client-1',
      ]),
    ) as { ciphertext: ArrayBuffer }
    await completed
    database.close()

    expect(keyRecord.key.extractable).toBe(false)
    await expect(webcrypto.subtle.exportKey(
      'raw',
      keyRecord.key as unknown as webcrypto.CryptoKey,
    )).rejects.toThrow()
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('Private offline')

    store = createStore()
    await expect(store.list(ownerUserId, senderDeviceId)).resolves.toEqual([pending])
    const sending: OutboxMessage = {
      ...pending,
      status: 'sending',
      attemptCount: 1,
      updatedAt: '2026-08-11T12:00:01Z',
    }
    await store.replace(sending)
    await expect(store.get(ownerUserId, senderDeviceId, 'client-1')).resolves.toEqual(sending)
    await store.remove(ownerUserId, senderDeviceId, 'client-1')
    await expect(store.list(ownerUserId, senderDeviceId)).resolves.toEqual([])
  })

  it('fails closed when ciphertext is altered', async () => {
    await store.enqueue(pending)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('outbox_messages', 'readwrite')
    const completed = transactionDone(transaction)
    const objectStore = transaction.objectStore('outbox_messages')
    const encrypted = await requestResult(
      objectStore.get([ownerUserId, senderDeviceId, 'client-1']),
    ) as { ciphertext: ArrayBuffer }
    const altered = new Uint8Array(encrypted.ciphertext.slice(0))
    altered[0] = (altered[0] ?? 0) ^ 0xff
    objectStore.put({
      ...encrypted,
      ownerUserId,
      senderDeviceId,
      clientMessageId: 'client-1',
      schemaVersion: 1,
      ciphertext: altered.buffer,
    })
    await completed
    database.close()

    store = createStore()
    await expect(store.list(ownerUserId, senderDeviceId))
      .rejects.toMatchObject({ kind: 'corrupt' })
  })

  it('atomically refuses to grow beyond the account limit', async () => {
    store.close()
    store = createStore(2)
    await store.enqueue(pending)
    await store.enqueue({ ...pending, clientMessageId: 'client-2' })
    await expect(store.enqueue({ ...pending, clientMessageId: 'client-3' }))
      .rejects.toMatchObject({ kind: 'queue-full' })
    await expect(store.list(ownerUserId, senderDeviceId)).resolves.toHaveLength(2)
  })

  it('never exposes or replaces another device outbox', async () => {
    await store.enqueue(pending)
    await store.enqueue({
      ...pending,
      senderDeviceId: 'device-2',
      ciphertextBase64: 'ZGlmZmVyZW50IGRldmljZQ==',
    })

    await expect(store.list(ownerUserId, senderDeviceId)).resolves.toEqual([pending])
    await expect(store.get(ownerUserId, 'device-2', 'client-1')).resolves.toMatchObject({
      senderDeviceId: 'device-2',
      ciphertextBase64: 'ZGlmZmVyZW50IGRldmljZQ==',
    })
    await store.remove(ownerUserId, senderDeviceId, 'client-1')
    await expect(store.get(ownerUserId, senderDeviceId, 'client-1')).resolves.toBeNull()
    await expect(store.get(ownerUserId, 'device-2', 'client-1')).resolves.not.toBeNull()
  })
})
