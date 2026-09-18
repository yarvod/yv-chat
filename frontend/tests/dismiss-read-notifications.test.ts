import { describe, expect, it, vi } from 'vitest'

import { DismissReadNotifications } from '../app/application/notifications/dismiss-read-notifications'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'

function setup() {
  const notifications = {
    listMessages: vi.fn().mockResolvedValue([
      { id: 'one', conversationId: 'chat', messageId: 'm1' },
      { id: 'two', conversationId: 'chat', messageId: 'm2' },
      { id: 'new', conversationId: 'chat', messageId: 'm3' },
      { id: 'other', conversationId: 'other', messageId: 'm4' },
    ]),
    dismissMessages: vi.fn().mockResolvedValue(undefined),
  }
  const gateway = { getMessage: vi.fn<MessagingGateway['getMessage']>() }
  return { notifications, gateway, useCase: new DismissReadNotifications(notifications, gateway) }
}

describe('dismiss read notifications', () => {
  it('dismisses only exact messages through the confirmed read cursor, regardless of unread count', async () => {
    const { useCase, notifications, gateway } = setup()
    await useCase.execute([{ conversationId: 'chat', lastReadSequence: 2 }], [
      { conversationId: 'chat', messageId: 'm1', sequence: 1 },
      { conversationId: 'chat', messageId: 'm2', sequence: 2 },
      { conversationId: 'chat', messageId: 'm3', sequence: 3 },
    ])
    expect(notifications.dismissMessages).toHaveBeenCalledWith([
      { id: 'one', conversationId: 'chat', messageId: 'm1' },
      { id: 'two', conversationId: 'chat', messageId: 'm2' },
    ])
    expect(gateway.getMessage).not.toHaveBeenCalled()
  })

  it('resolves notifications outside the loaded window without decrypting, and preserves failed lookups', async () => {
    const { useCase, notifications, gateway } = setup()
    // Only fields used at this metadata boundary are needed by the fake.
    gateway.getMessage.mockImplementation(async (conversationId, messageId) => {
      if (messageId === 'm2') throw new Error('offline')
      return { conversationId, messageId, sequence: messageId === 'm1' ? 1 : 3,
        clientMessageId: 'client', senderUserId: 'sender', senderDeviceId: 'device',
        protocolVersion: 2, ciphertextBase64: 'opaque', cryptoGenerationId: null, cryptoEpoch: null,
        createdAt: '', expiresAt: '', deletedAt: null, deletionReason: null }
    })
    await useCase.execute([{ conversationId: 'chat', lastReadSequence: 2 }])
    expect(gateway.getMessage).toHaveBeenCalledTimes(3)
    expect(gateway.getMessage).not.toHaveBeenCalledWith('other', 'm4')
    expect(notifications.dismissMessages).toHaveBeenCalledWith([
      { id: 'one', conversationId: 'chat', messageId: 'm1' },
    ])
  })

  it('does nothing without confirmed reads and never fails messaging when the OS rejects cleanup', async () => {
    const { useCase, notifications } = setup()
    await useCase.execute([{ conversationId: 'chat', lastReadSequence: 0 }])
    expect(notifications.listMessages).not.toHaveBeenCalled()
    notifications.listMessages.mockRejectedValueOnce(new Error('unsupported OS'))
    await expect(useCase.execute([{ conversationId: 'chat', lastReadSequence: 2 }])).resolves.toBeUndefined()
  })

  it('coalesces rapid read advances and retries OS failures without an unbounded task queue', async () => {
    const { useCase, notifications } = setup()
    const known = [1, 2, 3].map(sequence => ({ conversationId: 'chat', messageId: `m${sequence}`, sequence }))
    const first = useCase.execute([{ conversationId: 'chat', lastReadSequence: 1 }], known)
    const second = useCase.execute([{ conversationId: 'chat', lastReadSequence: 2 }], known)
    const third = useCase.execute([{ conversationId: 'chat', lastReadSequence: 1 }], known)
    await Promise.all([first, second, third])
    expect(notifications.listMessages).toHaveBeenCalledTimes(1)
    expect(notifications.dismissMessages.mock.calls[0]?.[0]).toHaveLength(2)
    notifications.dismissMessages.mockRejectedValueOnce(new Error('OS busy'))
    await expect(useCase.execute([{ conversationId: 'chat', lastReadSequence: 3 }], known)).resolves.toBeUndefined()
    await useCase.execute([{ conversationId: 'chat', lastReadSequence: 3 }], known)
    expect(notifications.dismissMessages).toHaveBeenCalledTimes(3)
  })
})
