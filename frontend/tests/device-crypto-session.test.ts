import { describe, expect, it, vi } from 'vitest'

import type { ClientIdGenerator } from '../app/application/ports/client-id-generator'
import type {
  ConversationCryptoGateway,
  ConversationCryptoGeneration,
} from '../app/application/ports/conversation-crypto-gateway'
import type {
  ConversationCryptoLocalState,
  ConversationCryptoStateRepository,
} from '../app/application/ports/conversation-crypto-state-repository'
import type { DeviceCryptoGateway } from '../app/application/ports/device-crypto-gateway'
import type { DeviceCryptoRegistryGateway } from '../app/application/ports/device-crypto-registry-gateway'
import type { DeviceKeyPackageGateway } from '../app/application/ports/device-key-package-gateway'
import type { MlsConversationGateway } from '../app/application/ports/mls-conversation-gateway'
import { DeviceCryptoSession } from '../app/bootstrap/device-crypto-session'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const coordinatorUserId = 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd'
const coordinatorDeviceId = '318887ee-2517-45fc-9635-07cf915b31b4'
const conversationId = 'f34b0d48-6dc9-4ed1-9c5b-eb76544ead0a'
const generationId = 'd8f16ee6-7063-494e-a71b-558392476527'

const identity = {
  userId,
  deviceId,
  revision: 1,
  fingerprint: 'ab'.repeat(32),
  credentialIdentity: new Uint8Array(33),
  signaturePublicKey: new Uint8Array(32),
  keyPackage: new Uint8Array([1]),
}

class MemoryState implements ConversationCryptoStateRepository {
  value: ConversationCryptoLocalState | null = null

  async load(): Promise<ConversationCryptoLocalState | null> {
    return this.value
  }

  async save(state: ConversationCryptoLocalState): Promise<void> {
    this.value = state
  }

  close(): void {}
}

describe('shared authenticated device crypto session', () => {
  it('single-flights concurrent history reconciliation and caches only ready state', async () => {
    const registry: DeviceCryptoRegistryGateway = {
      getCurrent: vi.fn(async () => ({
        userId,
        deviceId,
        protocolVersion: 2,
        credentialIdentity: identity.credentialIdentity,
        signaturePublicKey: identity.signaturePublicKey,
        fingerprint: identity.fingerprint,
        initialKeyPackageRef: 'cd'.repeat(32),
        createdAt: '2026-08-11T12:00:00Z',
      })),
      register: vi.fn(),
    }
    const packages: DeviceKeyPackageGateway = {
      listInventory: vi.fn(async () => ({ deviceId, availableCount: 8 })),
      replenish: vi.fn(),
      claim: vi.fn(),
    }
    const begin = vi.fn(async () => readyGeneration())
    const conversations: ConversationCryptoGateway = {
      getCurrent: vi.fn(async () => readyGeneration()),
      listReadyAfter: vi.fn(async (_conversationId, after) => (
        after < 1 ? [readyGeneration()] : []
      )),
      begin,
      finalize: vi.fn(),
      acknowledgeWelcome: vi.fn(async () => undefined),
    }
    const joinConversation = vi.fn(async () => ({ epoch: 1, revision: 2 }))
    const gateway = {
      provision: vi.fn(),
      restore: vi.fn(async () => identity),
      checkpoint: vi.fn(),
      validateKeyPackage: vi.fn(async () => ({ validated: true as const })),
      generateKeyPackages: vi.fn(),
      bootstrapConversation: vi.fn(),
      joinConversation,
      rejoinConversation: vi.fn(),
      updateConversation: vi.fn(),
      applyCommit: vi.fn(),
      protectMessage: vi.fn(),
      unprotectMessage: vi.fn(),
      dispose: vi.fn(async () => undefined),
    } satisfies DeviceCryptoGateway & MlsConversationGateway
    const ids: ClientIdGenerator = { create: () => crypto.randomUUID() }
    const session = new DeviceCryptoSession(
      registry,
      packages,
      conversations,
      new MemoryState(),
      ids,
      () => gateway,
    )
    await session.initialize({ userId, deviceId })

    const results = await Promise.all(Array.from(
      { length: 20 },
      () => session.reconcileConversation(conversationId),
    ))
    expect(results.every(result => result.status === 'ready')).toBe(true)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(joinConversation).toHaveBeenCalledTimes(1)

    await session.reconcileConversation(conversationId)
    expect(begin).toHaveBeenCalledTimes(1)
    session.invalidateConversation(conversationId)
    await session.reconcileConversation(conversationId)
    expect(begin).toHaveBeenCalledTimes(2)
    expect(joinConversation).toHaveBeenCalledTimes(1)
    await session.dispose()
  })
})

function readyGeneration(): ConversationCryptoGeneration {
  return {
    generationId,
    conversationId,
    generationNumber: 1,
    protocolVersion: 2,
    status: 'ready',
    blockReason: null,
    coordinatorDeviceId,
    epoch: 1,
    commit: new Uint8Array([1]),
    ratchetTree: new Uint8Array([2]),
    createdAt: '2026-08-11T12:00:00Z',
    updatedAt: '2026-08-11T12:01:00Z',
    readyAt: '2026-08-11T12:01:00Z',
    requiredDevices: [
      {
        userId: coordinatorUserId,
        deviceId: coordinatorDeviceId,
        isCoordinator: true,
        fingerprint: 'ef'.repeat(32),
        credentialIdentity: new Uint8Array(33),
        signaturePublicKey: new Uint8Array(32),
        keyPackageRef: null,
        keyPackage: null,
      },
      {
        userId,
        deviceId,
        isCoordinator: false,
        fingerprint: identity.fingerprint,
        credentialIdentity: identity.credentialIdentity,
        signaturePublicKey: identity.signaturePublicKey,
        keyPackageRef: 'cd'.repeat(32),
        keyPackage: new Uint8Array([3]),
      },
    ],
    welcome: {
      targetDeviceId: deviceId,
      welcome: new Uint8Array([4]),
      createdAt: '2026-08-11T12:01:00Z',
      expiresAt: '2026-08-12T12:01:00Z',
      acknowledgedAt: null,
    },
  }
}
