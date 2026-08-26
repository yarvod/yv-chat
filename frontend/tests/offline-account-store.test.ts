import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { IndexedDbOfflineAccountStore } from '../app/infrastructure/storage/indexeddb-offline-account-store'

const databaseName = 'yv-chat-offline-account-v1'
const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  deviceId: '1a166081-37d5-40ea-8238-3f639e7be090',
  username: 'private-alice',
  displayName: 'Private Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
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
let store: IndexedDbOfflineAccountStore

beforeEach(() => {
  indexedDb = new IDBFactory()
  store = new IndexedDbOfflineAccountStore(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
  )
})

afterEach(() => store.close())

describe('encrypted offline account store', () => {
  it('round-trips the last confirmed account without plaintext or an extractable key', async () => {
    await store.save(account)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction(['account_keys', 'accounts'], 'readonly')
    const completed = transactionDone(transaction)
    const keyRecord = await requestResult(
      transaction.objectStore('account_keys').get('current'),
    ) as { key: CryptoKey }
    const encrypted = await requestResult(
      transaction.objectStore('accounts').get('current'),
    ) as { ciphertext: ArrayBuffer }
    await completed
    database.close()

    expect(keyRecord.key.extractable).toBe(false)
    await expect(webcrypto.subtle.exportKey(
      'raw',
      keyRecord.key as unknown as webcrypto.CryptoKey,
    )).rejects.toThrow()
    const opaque = new TextDecoder().decode(encrypted.ciphertext)
    expect(opaque).not.toContain(account.username)
    expect(opaque).not.toContain(account.displayName)

    store = new IndexedDbOfflineAccountStore(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    await expect(store.load()).resolves.toEqual(account)
  })

  it('fails closed when encrypted account bytes are altered', async () => {
    await store.save(account)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('accounts', 'readwrite')
    const completed = transactionDone(transaction)
    const objectStore = transaction.objectStore('accounts')
    const encrypted = await requestResult(objectStore.get('current')) as {
      ciphertext: ArrayBuffer
    }
    const altered = new Uint8Array(encrypted.ciphertext.slice(0))
    altered[0] = (altered[0] ?? 0) ^ 0xff
    objectStore.put({ ...encrypted, id: 'current', ciphertext: altered.buffer })
    await completed
    database.close()

    store = new IndexedDbOfflineAccountStore(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    await expect(store.load()).rejects.toMatchObject({ kind: 'corrupt' })
  })

  it('removes only the current account projection', async () => {
    await store.save(account)
    await store.clear()
    await expect(store.load()).resolves.toBeNull()
  })
})
