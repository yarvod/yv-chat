import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { HapticsPort } from '../app/application/ports/haptics'
import type { ClientIdGenerator } from '../app/application/ports/client-id-generator'
import { syntheticMessageCodec } from '../app/infrastructure/crypto/synthetic-message-codec'
import { useMessenger } from '../app/presentation/composables/useMessenger'

const conversation = {
  conversationId: 'conversation-1',
  conversationType: 'direct' as const,
  title: null,
  createdBy: 'alice-id',
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  members: [],
}

const message = {
  messageId: 'message-1',
  clientMessageId: 'client-1',
  conversationId: 'conversation-1',
  senderUserId: 'bob-id',
  senderDeviceId: 'device-1',
  protocolVersion: 1,
  sequence: 1,
  createdAt: '2026-08-11T12:00:01Z',
  ciphertextBase64: 'aGVsbG8=',
}

let gateway: MessagingGateway
const haptics: HapticsPort = { isEnabled: () => true, setEnabled: vi.fn(), perform: vi.fn() }
const clientIdGenerator: ClientIdGenerator = { create: () => 'client-generated-id' }

beforeEach(() => {
  gateway = {
    listDirectory: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue([conversation]),
    createDirect: vi.fn(),
    createGroup: vi.fn(),
    listMessages: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([message]),
    sendMessage: vi.fn(),
    listSync: vi.fn()
      .mockResolvedValueOnce({ events: [], nextCursor: 4, streamCursor: 4, hasMore: false, resetRequired: false })
      .mockResolvedValueOnce({
        events: [{
          eventId: 'event-5', cursor: 5, eventType: 'message_created',
          conversationId: 'conversation-1', messageId: 'message-1', createdAt: '2026-08-11T12:00:01Z',
        }],
        nextCursor: 5, streamCursor: 5, hasMore: false, resetRequired: false,
      }),
  }
})

describe('messenger orchestration', () => {
  it('captures a cursor baseline before snapshot and catches up newer messages', async () => {
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      codec: syntheticMessageCodec,
      haptics,
      clientIdGenerator,
    })

    await messenger.load()
    await messenger.poll()

    expect(vi.mocked(gateway.listSync).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(gateway.listConversations).mock.invocationCallOrder[0] ?? 0)
    expect(gateway.listSync).toHaveBeenNthCalledWith(2, 4)
    expect(gateway.listMessages).toHaveBeenLastCalledWith('conversation-1', 0)
    expect(messenger.state.messages).toEqual([message])
    expect(messenger.state.syncCursor).toBe(5)
  })
})
