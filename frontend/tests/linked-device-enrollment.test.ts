import { describe, expect, it, vi } from 'vitest'

import {
  EnrollLinkedDevice,
  type LinkedDeviceEnrollmentSession,
} from '../app/application/device-crypto/enroll-linked-device'
import { ApplicationError } from '../app/application/errors'
import type { ConversationCryptoGateway } from '../app/application/ports/conversation-crypto-gateway'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { Scheduler } from '../app/application/ports/scheduler'
import type { Conversation } from '../app/domain/messaging/models'

const targetDeviceId = 'target-device'
const directIds = ['direct-a', 'direct-b'] as const

function conversation(conversationId: string, conversationType: 'direct' | 'group'): Conversation {
  return {
    conversationId,
    conversationType,
    title: null,
    createdBy: 'alice',
    createdAt: '2026-08-13T18:00:00Z',
    updatedAt: '2026-08-13T18:00:00Z',
    members: [],
  }
}

function readyGeneration(conversationId: string, includesTarget: boolean) {
  return {
    generationId: `generation-${conversationId}`,
    conversationId,
    generationNumber: 2,
    protocolVersion: 2 as const,
    status: 'ready' as const,
    blockReason: null,
    coordinatorDeviceId: 'trusted-device',
    epoch: 2,
    commit: new Uint8Array(),
    ratchetTree: new Uint8Array(),
    createdAt: '2026-08-13T18:00:00Z',
    updatedAt: '2026-08-13T18:00:00Z',
    readyAt: '2026-08-13T18:00:00Z',
    requiredDevices: [{
      userId: 'alice',
      deviceId: includesTarget ? targetDeviceId : 'trusted-device',
      isCoordinator: true,
      fingerprint: 'fingerprint',
      credentialIdentity: new Uint8Array(),
      signaturePublicKey: new Uint8Array(),
      keyPackageRef: null,
      keyPackage: null,
    }],
    welcome: null,
  }
}

const scheduler: Scheduler = {
  once: (_delayMs, callback) => {
    queueMicrotask(callback)
    return { cancel: () => undefined }
  },
  repeat: () => ({ cancel: () => undefined }),
}

function messaging(): MessagingGateway {
  return {
    listConversations: vi.fn().mockResolvedValue([
      ...directIds.map(id => conversation(id, 'direct')),
      conversation('group-ignored', 'group'),
    ]),
  } as unknown as MessagingGateway
}

describe('linked device MLS enrollment', () => {
  it('waits for candidate identity, invalidates stale READY state, drains epochs, and verifies target roster', async () => {
    const ready = new Set<string>()
    const attempts = new Map<string, number>()
    const drained: string[] = []
    let drainer: ((conversationId: string) => Promise<void>) | null = null
    const session: LinkedDeviceEnrollmentSession = {
      setBeforeEpochAdvance: callback => { drainer = callback },
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(async (conversationId) => {
        await drainer?.(conversationId)
        const attempt = (attempts.get(conversationId) ?? 0) + 1
        attempts.set(conversationId, attempt)
        if (conversationId === 'direct-a' || attempt >= 2) ready.add(conversationId)
        return {
          status: ready.has(conversationId) ? 'ready' : 'blocked',
          generationId: `generation-${conversationId}`,
          generationNumber: 2,
          blockReason: ready.has(conversationId) ? null : 'device_roster_changed',
          epoch: ready.has(conversationId) ? 2 : null,
        }
      }),
    }
    const cryptoServer = {
      getCurrent: vi.fn(async (conversationId: string) => (
        readyGeneration(conversationId, ready.has(conversationId))
      )),
    } as unknown as ConversationCryptoGateway
    const progress = vi.fn()
    const enrollment = new EnrollLinkedDevice(
      messaging(),
      cryptoServer,
      session,
      scheduler,
      async (ownerUserId, conversationId) => {
        expect(ownerUserId).toBe('alice')
        drained.push(conversationId)
      },
      1,
      3,
    )

    const result = await enrollment.enroll('alice', targetDeviceId, progress)

    expect(result.complete).toBe(true)
    expect(result.readyConversations).toBe(2)
    expect(attempts.get('direct-a')).toBe(1)
    expect(attempts.get('direct-b')).toBe(2)
    expect(drained).toEqual(['direct-a', 'direct-b', 'direct-b'])
    expect(session.invalidateConversation).not.toHaveBeenCalledWith('group-ignored')
    expect(progress.mock.calls.at(-1)?.[0].complete).toBe(true)
  })

  it('does not claim completion when reconcile returns READY without the target leaf', async () => {
    const session: LinkedDeviceEnrollmentSession = {
      setBeforeEpochAdvance: vi.fn(),
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn().mockResolvedValue({
        status: 'ready',
        generationId: 'old-generation',
        generationNumber: 1,
        blockReason: null,
        epoch: 1,
      }),
    }
    const cryptoServer = {
      getCurrent: vi.fn(async (conversationId: string) => readyGeneration(conversationId, false)),
    } as unknown as ConversationCryptoGateway
    const enrollment = new EnrollLinkedDevice(
      messaging(),
      cryptoServer,
      session,
      scheduler,
      async () => undefined,
      1,
      2,
    )

    const result = await enrollment.enroll('alice', targetDeviceId)

    expect(result.complete).toBe(false)
    expect(result.pendingConversationIds).toEqual(directIds)
  })

  it('finishes with an explicit skip when a participant has no MLS-capable device', async () => {
    const session: LinkedDeviceEnrollmentSession = {
      setBeforeEpochAdvance: vi.fn(),
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(),
    }
    const cryptoServer = {
      getCurrent: vi.fn(async (conversationId: string) => (
        conversationId === 'direct-b'
          ? {
              ...readyGeneration(conversationId, true),
              status: 'blocked' as const,
              blockReason: 'missing_identity' as const,
              epoch: null,
              commit: null,
              ratchetTree: null,
              readyAt: null,
            }
          : readyGeneration(conversationId, true)
      )),
    } as unknown as ConversationCryptoGateway
    const enrollment = new EnrollLinkedDevice(
      messaging(),
      cryptoServer,
      session,
      scheduler,
      async () => undefined,
    )

    const result = await enrollment.enroll('alice', targetDeviceId)

    expect(result).toMatchObject({
      complete: true,
      totalConversations: 2,
      readyConversations: 1,
      pendingConversationIds: [],
      skippedConversationIds: ['direct-b'],
    })
    expect(session.reconcileConversation).not.toHaveBeenCalledWith('direct-b')
  })

  it('checks the pairing activity before doing per-conversation MLS work', async () => {
    const session: LinkedDeviceEnrollmentSession = {
      setBeforeEpochAdvance: vi.fn(),
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(),
    }
    const enrollment = new EnrollLinkedDevice(
      messaging(),
      { getCurrent: vi.fn() } as unknown as ConversationCryptoGateway,
      session,
      scheduler,
      async () => undefined,
    )
    const stopped = new ApplicationError(410, 'http', 'history sync was cancelled')
    const ensureActive = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(stopped)

    await expect(enrollment.enroll(
      'alice',
      targetDeviceId,
      () => undefined,
      ensureActive,
    )).rejects.toBe(stopped)

    expect(ensureActive).toHaveBeenCalledTimes(3)
    expect(session.reconcileConversation).not.toHaveBeenCalled()
  })

  it('reconciles every direct independently during authenticated foreground bootstrap', async () => {
    const session: LinkedDeviceEnrollmentSession = {
      setBeforeEpochAdvance: vi.fn(),
      invalidateConversation: vi.fn(),
      reconcileConversation: vi.fn(async (conversationId) => {
        if (conversationId === 'direct-a') throw new Error('local state unavailable')
        return {
          status: 'ready',
          generationId: 'ready',
          generationNumber: 2,
          blockReason: null,
          epoch: 2,
        }
      }),
    }
    const enrollment = new EnrollLinkedDevice(
      messaging(),
      { getCurrent: vi.fn() } as unknown as ConversationCryptoGateway,
      session,
      scheduler,
      async () => undefined,
    )

    await enrollment.reconcileCurrentRoster('alice')

    expect(session.reconcileConversation).toHaveBeenCalledWith('direct-a')
    expect(session.reconcileConversation).toHaveBeenCalledWith('direct-b')
  })
})
