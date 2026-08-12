import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MessengerSnapshot } from '../app/application/ports/messenger-snapshot-store'
import { IndexedDbMessengerSnapshotStore } from '../app/infrastructure/storage/indexeddb-messenger-snapshot-store'

const ownerUserId = 'user-1'
const databaseName = 'yv-chat-messenger-snapshot-v1'

const snapshot: MessengerSnapshot = {
  ownerUserId,
  directory: [{ userId: 'user-2', username: 'bob', displayName: 'Private Bob' }],
  conversations: [{
    conversationId: 'conversation-1',
    conversationType: 'direct',
    title: null,
    createdBy: ownerUserId,
    createdAt: '2026-08-11T12:00:00Z',
    updatedAt: '2026-08-11T12:01:00Z',
    members: [{
      userId: 'user-2',
      username: 'bob',
      displayName: 'Private Bob',
      role: 'member',
      joinedAt: '2026-08-11T12:00:00Z',
      leftAt: null,
    }],
  }],
  readStates: [{
    conversationId: 'conversation-1',
    lastReadSequence: 4,
    latestSequence: 5,
    unreadCount: 1,
  }],
  deliveryStates: [{
    conversationId: 'conversation-1',
    userId: 'user-2',
    deliveredSequence: 3,
  }],
  viewportAnchors: [{
    conversationId: 'conversation-1',
    messageId: 'message-4',
    sequence: 4,
    offset: 18.5,
    atLatest: false,
    savedAt: '2026-08-11T12:01:30Z',
  }],
  syncCursor: 17,
  savedAt: '2026-08-11T12:02:00Z',
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
let store: IndexedDbMessengerSnapshotStore

beforeEach(() => {
  indexedDb = new IDBFactory()
  store = new IndexedDbMessengerSnapshotStore(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
  )
})

afterEach(() => store.close())

describe('encrypted messenger snapshot store', () => {
  it('round-trips a snapshot without exposing DTOs or an extractable key', async () => {
    await store.save(snapshot)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction(['snapshot_keys', 'snapshots'], 'readonly')
    const completed = transactionDone(transaction)
    const keyRecord = await requestResult(
      transaction.objectStore('snapshot_keys').get(ownerUserId),
    ) as { key: CryptoKey }
    const encrypted = await requestResult(
      transaction.objectStore('snapshots').get(ownerUserId),
    ) as { iv: ArrayBuffer, ciphertext: ArrayBuffer }
    await completed
    database.close()

    expect(keyRecord.key.extractable).toBe(false)
    await expect(webcrypto.subtle.exportKey(
      'raw',
      keyRecord.key as unknown as webcrypto.CryptoKey,
    )).rejects.toThrow()
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('Private Bob')

    store = new IndexedDbMessengerSnapshotStore(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    await expect(store.load(ownerUserId)).resolves.toEqual(snapshot)
    await expect(store.load('other-user')).resolves.toBeNull()
  })

  it('fails closed when the encrypted snapshot is altered', async () => {
    await store.save(snapshot)
    store.close()
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('snapshots', 'readwrite')
    const completed = transactionDone(transaction)
    const objectStore = transaction.objectStore('snapshots')
    const encrypted = await requestResult(objectStore.get(ownerUserId)) as {
      ciphertext: ArrayBuffer
    }
    const altered = new Uint8Array(encrypted.ciphertext.slice(0))
    altered[0] = (altered[0] ?? 0) ^ 0xff
    objectStore.put({ ...encrypted, ownerUserId, schemaVersion: 1, ciphertext: altered.buffer })
    await completed
    database.close()

    store = new IndexedDbMessengerSnapshotStore(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    await expect(store.load(ownerUserId)).rejects.toMatchObject({ kind: 'corrupt' })
  })
})
