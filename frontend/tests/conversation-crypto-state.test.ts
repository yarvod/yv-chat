import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ConversationCryptoLocalState } from '../app/application/ports/conversation-crypto-state-repository'
import { IndexedDbConversationCryptoState } from '../app/infrastructure/storage/indexeddb-conversation-crypto-state'

const ownerDeviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const conversationId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const otherConversationId = 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd'
const databaseName = 'yv-chat-conversation-crypto-v1'

const state: ConversationCryptoLocalState = {
  ownerDeviceId,
  conversationId,
  bootstrapRequestId: '318887ee-2517-45fc-9635-07cf915b31b4',
  generationId: 'f34b0d48-6dc9-4ed1-9c5b-eb76544ead0a',
  generationNumber: 1,
  phase: 'coordinator-checkpointed',
  epoch: 2,
  commit: new Uint8Array([1, 2]),
  ratchetTree: new Uint8Array([3, 4]),
  welcome: new Uint8Array([5, 6]),
  targetDeviceIds: ['d8f16ee6-7063-494e-a71b-558392476527'],
  updatedAt: '2026-08-11T12:00:00Z',
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
let store: IndexedDbConversationCryptoState

beforeEach(() => {
  indexedDb = new IDBFactory()
  store = new IndexedDbConversationCryptoState(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
  )
})

afterEach(() => store.close())

describe('encrypted conversation crypto control state', () => {
  it('round-trips atomic MLS coordination bytes without plaintext IndexedDB records', async () => {
    await store.save(state)
    await expect(store.load(ownerDeviceId, conversationId)).resolves.toEqual(state)
    await expect(store.load(ownerDeviceId, otherConversationId)).resolves.toBeNull()

    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction(['device_keys', 'conversation_states'], 'readonly')
    const completed = transactionDone(transaction)
    const keyRecord = await requestResult(
      transaction.objectStore('device_keys').get(ownerDeviceId),
    ) as { key: CryptoKey }
    const encrypted = await requestResult(
      transaction.objectStore('conversation_states').get(`${ownerDeviceId}:${conversationId}`),
    ) as { ciphertext: ArrayBuffer }
    await completed
    database.close()

    expect(keyRecord.key.extractable).toBe(false)
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain(
      state.bootstrapRequestId,
    )
  })

  it('fails closed when a persisted checkpoint is altered', async () => {
    await store.save(state)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('conversation_states', 'readwrite')
    const completed = transactionDone(transaction)
    const objectStore = transaction.objectStore('conversation_states')
    const key = `${ownerDeviceId}:${conversationId}`
    const encrypted = await requestResult(objectStore.get(key)) as { ciphertext: ArrayBuffer }
    const altered = new Uint8Array(encrypted.ciphertext.slice(0))
    altered[0] = (altered[0] ?? 0) ^ 0xff
    objectStore.put({ ...encrypted, storageKey: key, ciphertext: altered.buffer })
    await completed
    database.close()

    store = new IndexedDbConversationCryptoState(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    await expect(store.load(ownerDeviceId, conversationId))
      .rejects.toMatchObject({ kind: 'corrupt' })
  })
})
