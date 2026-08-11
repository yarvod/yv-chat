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
} from '../public/crypto/v2/yv_chat_openmls_provider.js'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const otherDeviceId = 'd44483ee-2c69-4eef-aeba-5ce92bc9181d'

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
  const wasm = await readFile('public/crypto/v2/yv_chat_openmls_provider_bg.wasm')
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
    runtime.dispose()
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
})
