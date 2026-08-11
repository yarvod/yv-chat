import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CryptoVaultError,
  IndexedDbCryptoVault,
  type SealedCryptoStateDraft,
} from '../app/infrastructure/storage/indexeddb-crypto-vault'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const fingerprint = 'ab'.repeat(32)
const databaseName = 'yv-chat-crypto-v1'

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

function draft(revision: number): SealedCryptoStateDraft {
  return {
    revision,
    fingerprint,
    iv: new Uint8Array(12).fill(revision),
    ciphertext: new Uint8Array(32).fill(revision),
  }
}

let indexedDb: IDBFactory
let vault: IndexedDbCryptoVault

beforeEach(() => {
  indexedDb = new IDBFactory()
  vault = new IndexedDbCryptoVault(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
  )
})

describe('IndexedDB crypto vault', () => {
  it('atomically bootstraps a non-extractable device key and sealed state', async () => {
    const seal = vi.fn(async (key: CryptoKey) => {
      expect(key.extractable).toBe(false)
      expect(key.type).toBe('secret')
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
      expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt'])
      await expect(webcrypto.subtle.exportKey('raw', key as unknown as webcrypto.CryptoKey))
        .rejects.toThrow()
      return draft(1)
    })

    const created = await vault.bootstrap(userId, deviceId, seal)
    expect(created.state).toMatchObject({ userId, deviceId, revision: 1, fingerprint })
    expect(seal).toHaveBeenCalledOnce()

    vault.close()
    const reopened = new IndexedDbCryptoVault(
      indexedDb,
      webcrypto.subtle as unknown as SubtleCrypto,
    )
    const loaded = await reopened.load(userId, deviceId)
    expect(loaded.status).toBe('ready')
    if (loaded.status === 'ready') {
      expect(loaded.state.iv).toEqual(draft(1).iv)
      expect(loaded.state.ciphertext).toEqual(draft(1).ciphertext)
      expect(loaded.wrappingKey.extractable).toBe(false)
    }
  })

  it('updates only to the next revision with the same fingerprint', async () => {
    await vault.bootstrap(userId, deviceId, async () => draft(1))
    const updated = await vault.update(userId, deviceId, async (key, revision) => {
      expect(key.extractable).toBe(false)
      expect(revision).toBe(2)
      return draft(revision)
    })
    expect(updated.revision).toBe(2)
    const loaded = await vault.load(userId, deviceId)
    expect(loaded.status === 'ready' && loaded.state.revision).toBe(2)

    await expect(vault.update(userId, deviceId, async (_key, revision) => ({
      ...draft(revision),
      fingerprint: 'cd'.repeat(32),
    }))).rejects.toMatchObject({ kind: 'rollback' })

    await expect(vault.update(userId, deviceId, async () => draft(2)))
      .rejects.toMatchObject({ kind: 'rollback' })

    const unchanged = await vault.load(userId, deviceId)
    expect(unchanged.status === 'ready' && unchanged.state.revision).toBe(2)
  })

  it('does not write a partial bootstrap when sealing fails', async () => {
    await expect(vault.bootstrap(userId, deviceId, async () => {
      throw new Error('synthetic failure')
    })).rejects.toThrow('synthetic failure')
    await expect(vault.load(userId, deviceId)).resolves.toEqual({ status: 'missing' })
  })

  it('isolates records by device and rejects malformed sealed metadata', async () => {
    const otherDeviceId = 'd44483ee-2c69-4eef-aeba-5ce92bc9181d'
    await vault.bootstrap(userId, deviceId, async () => draft(1))
    await expect(vault.load(userId, otherDeviceId)).resolves.toEqual({ status: 'missing' })
    await expect(vault.bootstrap(userId, otherDeviceId, async () => ({
      ...draft(1),
      iv: new Uint8Array(11),
    }))).rejects.toBeInstanceOf(CryptoVaultError)
    await expect(vault.load(userId, otherDeviceId)).resolves.toEqual({ status: 'missing' })
  })

  it('fails closed when an interrupted writer leaves only a wrapping key', async () => {
    await expect(vault.load(userId, deviceId)).resolves.toEqual({ status: 'missing' })
    const key = await webcrypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const database = await requestResult(indexedDb.open(databaseName, 1))
    const transaction = database.transaction('wrapping_keys', 'readwrite')
    const completed = transactionDone(transaction)
    transaction.objectStore('wrapping_keys').add({
      deviceId,
      key,
      createdAt: Date.now(),
    })
    await completed
    database.close()

    await expect(vault.load(userId, deviceId)).rejects.toMatchObject({ kind: 'corrupt' })
  })
})
