// @vitest-environment node

import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { IDBFactory } from 'fake-indexeddb'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DeviceCryptoError } from '../app/application/device-crypto/errors'
import { DeviceCryptoRuntime } from '../app/infrastructure/crypto/device-crypto-runtime'
import type { OpenMlsModule } from '../app/infrastructure/crypto/openmls-module'
import { IndexedDbCryptoVault } from '../app/infrastructure/storage/indexeddb-crypto-vault'
import initOpenMls, {
  DeviceBootstrap,
  validatePublicKeyPackage,
} from '../public/crypto/v7/yv_chat_openmls_provider.js'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const otherDeviceId = 'd44483ee-2c69-4eef-aeba-5ce92bc9181d'
const otherUserId = 'abfef0af-10d0-4655-b4c7-84b3b418e4b7'
const thirdDeviceId = '47782869-4399-4534-9202-ae53bed6a0fa'
const thirdUserId = 'f26cf4db-07c7-41c5-9925-01da4a7f7b22'
const conversationId = 'f6a5941b-c417-4e50-a69c-9a30bd7ed28c'
const messageId = '538998bb-1943-4cf3-beb1-8b87cadf0fc1'

const openMlsModule: OpenMlsModule = {
  default: async () => undefined,
  DeviceBootstrap,
  validatePublicKeyPackage,
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function vault(indexedDb: IDBFactory): IndexedDbCryptoVault {
  return new IndexedDbCryptoVault(
    indexedDb,
    webcrypto.subtle as unknown as SubtleCrypto,
  )
}

beforeAll(async () => {
  const wasm = await readFile('public/crypto/v7/yv_chat_openmls_provider_bg.wasm')
  await initOpenMls({ module_or_path: wasm })
})

let indexedDb: IDBFactory

beforeEach(() => {
  indexedDb = new IDBFactory()
})

describe('device crypto runtime with the release OpenMLS WASM', () => {
  it('requires explicit provisioning and restores the exact identity after reload', async () => {
    const first = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    await expect(first.restore({ userId, deviceId })).rejects.toMatchObject({
      code: 'not-provisioned',
    })

    const provisioned = await first.provision({ userId, deviceId })
    expect(provisioned).toMatchObject({ userId, deviceId, revision: 1 })
    expect(provisioned.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(provisioned.credentialIdentity).toHaveLength(33)
    expect(provisioned.signaturePublicKey).toHaveLength(32)
    expect(provisioned.keyPackage.byteLength).toBeGreaterThan(0)
    first.dispose()

    const second = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    const restored = await second.restore({ userId, deviceId })
    expect(restored).toEqual(provisioned)
    const checkpointed = await second.checkpoint()
    expect(checkpointed).toEqual({ ...provisioned, revision: 2 })
    second.dispose()

    const third = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    await expect(third.restore({ userId, deviceId })).resolves.toEqual(checkpointed)
    third.dispose()
  })

  it('converges concurrent provision attempts on the committed identity', async () => {
    const first = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    const second = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    const [left, right] = await Promise.all([
      first.provision({ userId, deviceId }),
      second.provision({ userId, deviceId }),
    ])
    expect(right).toEqual(left)
    first.dispose()
    second.dispose()
  })

  it('validates claimed KeyPackages with OpenMLS and every public binding', async () => {
    const runtime = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    const identity = await runtime.provision({ userId, deviceId })
    const command = {
      targetUserId: userId,
      targetDeviceId: deviceId,
      credentialIdentity: identity.credentialIdentity,
      signaturePublicKey: identity.signaturePublicKey,
      fingerprint: identity.fingerprint,
      packageRef: await sha256Hex(identity.keyPackage),
      keyPackage: identity.keyPackage,
    }

    await expect(runtime.validateKeyPackage(command)).resolves.toEqual({ validated: true })
    await expect(runtime.validateKeyPackage({
      ...command,
      targetDeviceId: otherDeviceId,
    })).rejects.toMatchObject({ code: 'invalid-key-package' })
    await expect(runtime.validateKeyPackage({
      ...command,
      packageRef: '00'.repeat(32),
    })).rejects.toMatchObject({ code: 'invalid-key-package' })
    const corrupt = command.keyPackage.slice()
    corrupt[Math.floor(corrupt.length / 2)] ^= 1
    await expect(runtime.validateKeyPackage({
      ...command,
      keyPackage: corrupt,
      packageRef: await sha256Hex(corrupt),
    })).rejects.toMatchObject({ code: 'invalid-key-package' })
    const generated = await runtime.generateKeyPackages({ count: 4 })
    expect(generated).toMatchObject({ revision: 2 })
    expect(generated.keyPackages).toHaveLength(4)
    expect(new Set(generated.keyPackages.map(item => Buffer.from(item).toString('base64'))).size)
      .toBe(4)
    for (const keyPackage of generated.keyPackages) {
      await expect(runtime.validateKeyPackage({
        ...command,
        keyPackage,
        packageRef: await sha256Hex(keyPackage),
      })).resolves.toEqual({ validated: true })
    }
    runtime.dispose()
  })

  it('atomically checkpoints create, Welcome join and both message ratchets', async () => {
    const aliceDb = new IDBFactory()
    const bobDb = new IDBFactory()
    const alice = new DeviceCryptoRuntime(openMlsModule, vault(aliceDb))
    const bob = new DeviceCryptoRuntime(openMlsModule, vault(bobDb))
    await alice.provision({ userId, deviceId })
    const bobIdentity = await bob.provision({ userId: otherUserId, deviceId: otherDeviceId })

    const bootstrap = await alice.bootstrapConversation({
      conversationId,
      keyPackages: [bobIdentity.keyPackage],
    })
    expect(bootstrap).toMatchObject({ epoch: 1, revision: 2 })
    const joined = await bob.joinConversation({
      conversationId,
      welcome: bootstrap.welcome,
      ratchetTree: bootstrap.ratchetTree,
    })
    expect(joined).toEqual({ epoch: 1, revision: 2 })
    await expect(alice.inspectConversation({ conversationId })).resolves.toEqual({
      epoch: 1,
      deviceIds: [deviceId, otherDeviceId].sort(),
      revision: 2,
    })
    await expect(bob.inspectConversation({ conversationId })).resolves.toEqual({
      epoch: 1,
      deviceIds: [deviceId, otherDeviceId].sort(),
      revision: 2,
    })
    alice.dispose()
    bob.dispose()

    const restoredAlice = new DeviceCryptoRuntime(openMlsModule, vault(aliceDb))
    const restoredBob = new DeviceCryptoRuntime(openMlsModule, vault(bobDb))
    await restoredAlice.restore({ userId, deviceId })
    await restoredBob.restore({ userId: otherUserId, deviceId: otherDeviceId })
    const plaintext = new TextEncoder().encode('private hello')
    const protectedMessage = await restoredAlice.protectMessage({
      conversationId,
      clientMessageId: messageId,
      plaintext,
    })
    expect(protectedMessage.epoch).toBe(1)
    expect(protectedMessage.revision).toBe(3)
    expect(protectedMessage.ciphertext).not.toEqual(plaintext)
    await expect(restoredAlice.unprotectMessage({
      conversationId,
      clientMessageId: messageId,
      ciphertext: protectedMessage.ciphertext,
    })).resolves.toMatchObject({ plaintext, revision: 3 })

    await expect(restoredBob.unprotectMessage({
      conversationId,
      clientMessageId: '784ace60-fba9-445d-b1e4-df34d56ad053',
      ciphertext: protectedMessage.ciphertext,
    })).rejects.toMatchObject({ code: 'operation-failed' })
    const unprotected = await restoredBob.unprotectMessage({
      conversationId,
      clientMessageId: messageId,
      ciphertext: protectedMessage.ciphertext,
    })
    expect(unprotected.plaintext).toEqual(plaintext)
    expect(unprotected.revision).toBe(3)
    await expect(restoredBob.unprotectMessage({
      conversationId,
      clientMessageId: messageId,
      ciphertext: protectedMessage.ciphertext,
    })).resolves.toMatchObject({ plaintext, revision: 3 })
    restoredAlice.dispose()
    restoredBob.dispose()

    const reloadedBob = new DeviceCryptoRuntime(openMlsModule, vault(bobDb))
    await reloadedBob.restore({ userId: otherUserId, deviceId: otherDeviceId })
    await expect(reloadedBob.unprotectMessage({
      conversationId,
      clientMessageId: messageId,
      ciphertext: protectedMessage.ciphertext,
    })).resolves.toMatchObject({ plaintext, revision: 3 })
    reloadedBob.dispose()
  })

  it('fails closed for wrong AAD and modified ciphertext without replacing identity', async () => {
    const initial = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    const identity = await initial.provision({ userId, deviceId })
    initial.dispose()

    const directVault = vault(indexedDb)
    const loaded = await directVault.load(userId, deviceId)
    expect(loaded.status).toBe('ready')
    if (loaded.status !== 'ready') throw new Error('expected committed state')
    await expect(DeviceBootstrap.restoreSealedState(
      loaded.wrappingKey,
      userId,
      otherDeviceId,
      identity.fingerprint,
      1n,
      loaded.state.iv,
      loaded.state.ciphertext,
    )).rejects.toThrow()

    await directVault.update(userId, deviceId, async (_key, revision) => {
      const ciphertext = loaded.state.ciphertext.slice()
      ciphertext[0] ^= 1
      return {
        revision,
        fingerprint: loaded.state.fingerprint,
        iv: loaded.state.iv,
        ciphertext,
      }
    })
    directVault.close()

    const corrupted = new DeviceCryptoRuntime(openMlsModule, vault(indexedDb))
    await expect(corrupted.restore({ userId, deviceId })).rejects.toBeInstanceOf(DeviceCryptoError)
    await expect(corrupted.restore({ userId, deviceId })).rejects.toMatchObject({
      code: 'operation-failed',
    })
    corrupted.dispose()

    const persisted = await vault(indexedDb).load(userId, deviceId)
    expect(persisted.status === 'ready' && persisted.state.fingerprint).toBe(identity.fingerprint)
  })

  it('checkpoints add/remove Commit convergence and excludes a removed leaf from future epochs', async () => {
    const alice = new DeviceCryptoRuntime(openMlsModule, vault(new IDBFactory()))
    const bob = new DeviceCryptoRuntime(openMlsModule, vault(new IDBFactory()))
    const charlie = new DeviceCryptoRuntime(openMlsModule, vault(new IDBFactory()))
    await alice.provision({ userId, deviceId })
    const bobIdentity = await bob.provision({ userId: otherUserId, deviceId: otherDeviceId })
    const charlieIdentity = await charlie.provision({ userId: thirdUserId, deviceId: thirdDeviceId })
    const initial = await alice.bootstrapConversation({
      conversationId,
      keyPackages: [bobIdentity.keyPackage],
    })
    await bob.joinConversation({
      conversationId,
      welcome: initial.welcome,
      ratchetTree: initial.ratchetTree,
    })

    const withCharlie = [deviceId, otherDeviceId, thirdDeviceId]
    const added = await alice.updateConversation({
      conversationId,
      desiredDeviceIds: withCharlie,
      keyPackages: [charlieIdentity.keyPackage],
    })
    expect(added).toMatchObject({ epoch: 2, revision: 3 })
    expect(added.welcome).toBeInstanceOf(Uint8Array)
    await expect(bob.applyCommit({
      conversationId,
      commit: added.commit,
      desiredDeviceIds: withCharlie,
    })).resolves.toMatchObject({ epoch: 2, revision: 3 })
    if (added.welcome === null) throw new Error('new leaf requires Welcome')
    await charlie.joinConversation({
      conversationId,
      welcome: added.welcome,
      ratchetTree: added.ratchetTree,
    })

    const withoutBob = [deviceId, thirdDeviceId]
    const removed = await alice.updateConversation({
      conversationId,
      desiredDeviceIds: withoutBob,
      keyPackages: [],
    })
    expect(removed).toMatchObject({ epoch: 3, welcome: null, revision: 4 })
    await expect(charlie.applyCommit({
      conversationId,
      commit: removed.commit,
      desiredDeviceIds: withoutBob,
    })).resolves.toMatchObject({ epoch: 3, revision: 3 })

    const futureMessageId = 'c59e7dc2-9d80-4aac-8d46-a785c7844a25'
    const future = await alice.protectMessage({
      conversationId,
      clientMessageId: futureMessageId,
      plaintext: new TextEncoder().encode('after removal'),
    })
    await expect(charlie.unprotectMessage({
      conversationId,
      clientMessageId: futureMessageId,
      ciphertext: future.ciphertext,
    })).resolves.toMatchObject({ plaintext: new TextEncoder().encode('after removal') })
    await expect(bob.unprotectMessage({
      conversationId,
      clientMessageId: futureMessageId,
      ciphertext: future.ciphertext,
    })).rejects.toMatchObject({ code: 'operation-failed' })

    await bob.restore({ userId: otherUserId, deviceId: otherDeviceId })
    const bobRejoinPackages = await bob.generateKeyPackages({ count: 1 })
    const restoredRoster = [deviceId, otherDeviceId, thirdDeviceId]
    const readded = await alice.updateConversation({
      conversationId,
      desiredDeviceIds: restoredRoster,
      keyPackages: [bobRejoinPackages.keyPackages[0]!],
    })
    expect(readded).toMatchObject({ epoch: 4 })
    await expect(charlie.applyCommit({
      conversationId,
      commit: readded.commit,
      desiredDeviceIds: restoredRoster,
    })).resolves.toMatchObject({ epoch: 4 })
    if (readded.welcome === null) throw new Error('re-added leaf requires Welcome')
    await expect(bob.rejoinConversation({
      conversationId,
      welcome: readded.welcome,
      ratchetTree: readded.ratchetTree,
    })).resolves.toMatchObject({ epoch: 4 })

    const rejoinedMessageId = '9bef9594-6e42-447f-b252-e2921cb323a7'
    const afterRejoin = await alice.protectMessage({
      conversationId,
      clientMessageId: rejoinedMessageId,
      plaintext: new TextEncoder().encode('after rejoin'),
    })
    await expect(bob.unprotectMessage({
      conversationId,
      clientMessageId: rejoinedMessageId,
      ciphertext: afterRejoin.ciphertext,
    })).resolves.toMatchObject({ plaintext: new TextEncoder().encode('after rejoin') })
    alice.dispose()
    bob.dispose()
    charlie.dispose()
  })
})
