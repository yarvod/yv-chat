import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ConversationCryptoLocalState } from '../app/application/ports/conversation-crypto-state-repository'
import type { MediaCacheScope } from '../app/application/ports/media-cache'
import type { OpaqueMessage } from '../app/domain/messaging/models'
import { IndexedDbConversationCryptoState } from '../app/infrastructure/storage/indexeddb-conversation-crypto-state'
import { IndexedDbCryptoVault } from '../app/infrastructure/storage/indexeddb-crypto-vault'
import { IndexedDbMessageArchive } from '../app/infrastructure/storage/indexeddb-message-archive'
import { EncryptedMediaCache } from '../app/infrastructure/storage/encrypted-media-cache'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const conversationId = 'f6a5941b-c417-4e50-a69c-9a30bd7ed28c'
const now = Date.parse('2026-08-12T12:00:00Z')

function scope(attachmentId: string, byteSize: number, expiresAt = '2026-08-13T12:00:00Z'): MediaCacheScope {
  return {
    ownerUserId: userId,
    ownerDeviceId: deviceId,
    conversationId,
    expiresAt,
    attachment: {
      attachmentId,
      kind: 'image',
      name: `${attachmentId}.png`,
      contentType: 'image/png',
      byteSize,
    },
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    configurable: true,
    value: IDBKeyRange,
  })
  indexedDb = new IDBFactory()
})

describe('encrypted device media cache', () => {
  it('releases its connection when a newer PWA requests a database upgrade', async () => {
    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => now,
    )
    await cache.inspect(userId, deviceId)

    const upgraded = await requestResult(indexedDb.open('yv-chat-media-cache-v1', 2))

    expect(upgraded.version).toBe(2)
    upgraded.close()
  })

  it('round-trips authenticated chunks with a non-extractable key and no plaintext record', async () => {
    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      2 * 1024 * 1024 * 1024,
      () => now,
    )
    const value = new Blob(['private group photo'], { type: 'image/png' })
    const item = scope('attachment-1', value.size)

    await cache.store(item, value)
    await expect(cache.load(item).then(blob => blob?.text())).resolves.toBe('private group photo')
    cache.close()

    const database = await requestResult(indexedDb.open('yv-chat-media-cache-v1', 1))
    const transaction = database.transaction(['device_keys', 'entries', 'fallback_blobs'], 'readonly')
    const completed = transactionDone(transaction)
    const keys = await requestResult(transaction.objectStore('device_keys').getAll()) as Array<{ key: CryptoKey }>
    const entries = await requestResult(transaction.objectStore('entries').getAll()) as Array<{ objectName: string }>
    const encrypted = await requestResult(
      transaction.objectStore('fallback_blobs').get(entries[0]?.objectName),
    ) as { encryptedBytes: ArrayBuffer }
    await completed
    database.close()

    expect(keys).toHaveLength(1)
    expect(keys[0]?.key.extractable).toBe(false)
    expect(new TextDecoder().decode(encrypted.encryptedBytes)).not.toContain('private group photo')
  })

  it('stores a timeline preview as a separate authenticated cache variant', async () => {
    let cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => now,
    )
    const original = new Blob(['full-photo'], { type: 'image/png' })
    const preview = new Blob(['small-photo'], { type: 'image/png' })
    const item = scope('preview-attachment', original.size)

    await cache.store(item, original)
    await cache.storePreview(item, preview)

    await expect(cache.load(item).then(blob => blob?.text())).resolves.toBe('full-photo')
    await expect(cache.loadPreview(item).then(blob => blob?.text())).resolves.toBe('small-photo')
    cache.close()
    cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => now,
    )
    await expect(cache.loadPreview(item).then(blob => blob?.text())).resolves.toBe('small-photo')
    await expect(cache.inspect(userId, deviceId)).resolves.toEqual({
      usedBytes: original.size + preview.size,
      entryCount: 2,
      limitBytes: 1024,
    })

    const database = await requestResult(indexedDb.open('yv-chat-media-cache-v1', 1))
    const transaction = database.transaction(['entries', 'fallback_blobs'], 'readonly')
    const completed = transactionDone(transaction)
    const entries = await requestResult(transaction.objectStore('entries').getAll()) as Array<{
      objectName: string
      variant?: string
    }>
    const previewEntry = entries.find(entry => entry.variant === 'timeline-preview-v1')
    const encrypted = await requestResult(
      transaction.objectStore('fallback_blobs').get(previewEntry?.objectName),
    ) as { encryptedBytes: ArrayBuffer }
    await completed
    database.close()
    expect(new TextDecoder().decode(encrypted.encryptedBytes)).not.toContain('small-photo')
  })

  it('evicts least-recently-used entries within the configured per-device budget', async () => {
    let clock = now
    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      9,
      () => clock,
    )
    const first = scope('first', 5)
    const second = scope('second', 5)

    await cache.store(first, new Blob(['first'], { type: 'image/png' }))
    clock += 1
    await cache.store(second, new Blob(['other'], { type: 'image/png' }))

    await expect(cache.load(first)).resolves.toBeNull()
    await expect(cache.load(second).then(blob => blob?.text())).resolves.toBe('other')
  })

  it('reports and clears only the selected account device media without touching another device', async () => {
    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => now,
    )
    const first = new Blob(['first'], { type: 'image/png' })
    const second = new Blob(['other'], { type: 'image/png' })
    const firstScope = scope('first', first.size)
    const otherScope = {
      ...scope('second', second.size),
      ownerDeviceId: 'other-device',
    }
    await cache.store(firstScope, first)
    await cache.store(otherScope, second)

    await expect(cache.inspect(userId, deviceId)).resolves.toEqual({
      usedBytes: first.size,
      entryCount: 1,
      limitBytes: 1024,
    })
    await expect(cache.clear(userId, deviceId)).resolves.toEqual({
      usedBytes: 0,
      entryCount: 0,
      limitBytes: 1024,
    })
    await expect(cache.load(firstScope)).resolves.toBeNull()
    await expect(cache.load(otherScope).then(blob => blob?.text())).resolves.toBe('other')

    const database = await requestResult(indexedDb.open('yv-chat-media-cache-v1', 1))
    const transaction = database.transaction('device_keys', 'readonly')
    const completed = transactionDone(transaction)
    const keys = await requestResult(transaction.objectStore('device_keys').getAll())
    await completed
    database.close()
    expect(keys).toHaveLength(1)
  })

  it('treats expired, cross-device and altered metadata as cache misses', async () => {
    let clock = now
    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => clock,
    )
    const value = new Blob(['photo'], { type: 'image/png' })
    const item = scope('attachment-1', value.size)
    await cache.store(item, value)

    await expect(cache.load({ ...item, ownerDeviceId: 'other-device' })).resolves.toBeNull()
    await expect(cache.load({
      ...item,
      attachment: { ...item.attachment, contentType: 'image/jpeg' },
    })).resolves.toBeNull()
    clock = Date.parse(item.expiresAt) + 1
    await expect(cache.load(item)).resolves.toBeNull()
  })

  it('never upgrades or removes message archive and MLS key databases', async () => {
    const archive = new IndexedDbMessageArchive(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    const vault = new IndexedDbCryptoVault(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    const cryptoState = new IndexedDbConversationCryptoState(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
    )
    const message: OpaqueMessage = {
      messageId: 'message-1',
      clientMessageId: 'client-1',
      conversationId,
      senderUserId: userId,
      senderDeviceId: deviceId,
      protocolVersion: 1,
      cryptoGenerationId: null,
      cryptoEpoch: null,
      sequence: 1,
      createdAt: '2026-08-12T11:00:00Z',
      expiresAt: '2026-08-13T11:00:00Z',
      ciphertextBase64: 'bWVzc2FnZQ==',
      deletionReason: null,
      deletedAt: null,
    }
    const checkpoint: ConversationCryptoLocalState = {
      ownerDeviceId: deviceId,
      conversationId,
      bootstrapRequestId: '318887ee-2517-45fc-9635-07cf915b31b4',
      generationId: 'f34b0d48-6dc9-4ed1-9c5b-eb76544ead0a',
      generationNumber: 1,
      phase: 'ready',
      epoch: 2,
      commit: new Uint8Array([1, 2]),
      ratchetTree: new Uint8Array([3, 4]),
      welcome: null,
      targetDeviceIds: [],
      updatedAt: '2026-08-12T11:00:00Z',
    }
    await archive.put(userId, conversationId, [message])
    await vault.bootstrap(userId, deviceId, async () => ({
      revision: 1,
      fingerprint: 'ab'.repeat(32),
      iv: new Uint8Array(12).fill(1),
      ciphertext: new Uint8Array(32).fill(2),
    }))
    await cryptoState.save(checkpoint)

    const cache = new EncryptedMediaCache(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
      array => webcrypto.getRandomValues(array),
      null,
      1024,
      () => now,
    )
    const media = new Blob(['photo'], { type: 'image/png' })
    const mediaScope = scope('attachment-1', media.size)
    await cache.store(mediaScope, media)
    await cache.remove(mediaScope)
    cache.close()
    archive.close()
    vault.close()
    cryptoState.close()

    const reopenedArchive = new IndexedDbMessageArchive(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
    )
    const reopenedVault = new IndexedDbCryptoVault(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
    )
    const reopenedCryptoState = new IndexedDbConversationCryptoState(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
    )
    await expect(reopenedArchive.loadLatest(userId, conversationId, 100)).resolves.toEqual([message])
    await expect(reopenedCryptoState.load(deviceId, conversationId)).resolves.toEqual(checkpoint)
    const loadedVault = await reopenedVault.load(userId, deviceId)
    expect(loadedVault.status).toBe('ready')
    if (loadedVault.status === 'ready') {
      expect(loadedVault.wrappingKey.extractable).toBe(false)
      expect(loadedVault.state.revision).toBe(1)
    }

    const databases = await indexedDb.databases()
    expect(databases).toEqual(expect.arrayContaining([
      { name: 'yv-chat-messages-v1', version: 1 },
      { name: 'yv-chat-crypto-v1', version: 2 },
      { name: 'yv-chat-conversation-crypto-v1', version: 1 },
      { name: 'yv-chat-media-cache-v1', version: 1 },
    ]))
  })
})
