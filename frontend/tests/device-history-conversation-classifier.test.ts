import { describe, expect, it, vi } from 'vitest'

import { ClassifyDeviceHistoryConversation } from '../app/application/device-crypto/classify-device-history-conversation'
import type { ConversationCryptoGateway, ConversationCryptoGeneration } from '../app/application/ports/conversation-crypto-gateway'

const conversationId = '11111111-1111-4111-8111-111111111111'
const currentDeviceId = '22222222-2222-4222-8222-222222222222'
const targetDeviceId = '33333333-3333-4333-8333-333333333333'

function generation(
  overrides: Partial<ConversationCryptoGeneration> = {},
): ConversationCryptoGeneration {
  return {
    generationId: '44444444-4444-4444-8444-444444444444',
    conversationId,
    generationNumber: 7,
    protocolVersion: 2,
    status: 'ready',
    blockReason: null,
    coordinatorDeviceId: currentDeviceId,
    epoch: 6,
    commit: new Uint8Array([1]),
    ratchetTree: new Uint8Array([2]),
    createdAt: '2026-08-27T12:00:00Z',
    updatedAt: '2026-08-27T12:00:00Z',
    readyAt: '2026-08-27T12:00:00Z',
    requiredDevices: [currentDeviceId, targetDeviceId].map((deviceId, index) => ({
      userId: '55555555-5555-4555-8555-555555555555',
      deviceId,
      isCoordinator: index === 0,
      fingerprint: 'a'.repeat(64),
      credentialIdentity: new Uint8Array(33),
      signaturePublicKey: new Uint8Array(32),
      keyPackageRef: 'b'.repeat(64),
      keyPackage: new Uint8Array([3]),
    })),
    welcome: null,
    ...overrides,
  }
}

function gateway(current: () => ConversationCryptoGeneration | null): ConversationCryptoGateway {
  return {
    getCurrent: vi.fn(async () => current()),
    listReadyAfter: vi.fn(async () => []),
    begin: vi.fn(async () => generation()),
    finalize: vi.fn(async () => generation()),
    acknowledgeWelcome: vi.fn(async () => undefined),
  }
}

describe('device history conversation classifier', () => {
  it('requires the local MLS checkpoint to match the exact verified server generation', async () => {
    const server = gateway(() => generation())
    const session = {
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(async () => ({
        status: 'ready' as const,
        generationId: generation().generationId,
        generationNumber: 7,
        blockReason: null,
        epoch: 6,
      })),
    }

    await expect(new ClassifyDeviceHistoryConversation(server, session).execute(
      conversationId,
      currentDeviceId,
      targetDeviceId,
    )).resolves.toBe('ready')
    expect(session.invalidateConversation).toHaveBeenCalledWith(conversationId)
    expect(session.reconcileConversation).toHaveBeenCalledWith(conversationId)
    expect(server.getCurrent).toHaveBeenCalledTimes(2)
  })

  it('waits when an empty device has not consumed the exact Welcome yet', async () => {
    const session = {
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(async () => ({
        status: 'ready' as const,
        generationId: '66666666-6666-4666-8666-666666666666',
        generationNumber: 6,
        blockReason: null,
        epoch: 5,
      })),
    }
    await expect(new ClassifyDeviceHistoryConversation(gateway(() => generation()), session).execute(
      conversationId,
      currentDeviceId,
      targetDeviceId,
    )).resolves.toBe('pending')
  })

  it('skips only a terminal per-conversation identity/protocol block', async () => {
    const session = {
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(),
    }
    const blocked = generation({
      status: 'blocked',
      blockReason: 'missing_identity',
      epoch: null,
      readyAt: null,
    })
    await expect(new ClassifyDeviceHistoryConversation(gateway(() => blocked), session).execute(
      conversationId,
      currentDeviceId,
      targetDeviceId,
    )).resolves.toBe('skipped')
    expect(session.reconcileConversation).not.toHaveBeenCalled()
  })
})
