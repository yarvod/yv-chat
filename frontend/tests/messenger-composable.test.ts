import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessenger } from '../app/composables/useMessenger'
import {
  conversationService,
  directoryService,
  messageService,
  syncService,
} from '../app/services/messaging/api'

vi.mock('../app/services/messaging/api', () => ({
  conversationService: { list: vi.fn(), createDirect: vi.fn(), createGroup: vi.fn() },
  directoryService: { list: vi.fn() },
  messageService: { list: vi.fn(), send: vi.fn() },
  syncService: { list: vi.fn() },
}))

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

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(directoryService.list).mockResolvedValue([])
  vi.mocked(conversationService.list).mockResolvedValue([conversation])
  vi.mocked(messageService.list).mockResolvedValueOnce([]).mockResolvedValueOnce([message])
  vi.mocked(syncService.list)
    .mockResolvedValueOnce({
      events: [],
      nextCursor: 4,
      streamCursor: 4,
      hasMore: false,
      resetRequired: false,
    })
    .mockResolvedValueOnce({
      events: [{
        eventId: 'event-5',
        cursor: 5,
        eventType: 'message_created',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        createdAt: '2026-08-11T12:00:01Z',
      }],
      nextCursor: 5,
      streamCursor: 5,
      hasMore: false,
      resetRequired: false,
    })
})

describe('messenger orchestration', () => {
  it('captures a cursor baseline before snapshot and catches up newer messages', async () => {
    const messenger = useMessenger('alice-id', vi.fn())

    await messenger.load()
    await messenger.poll()

    expect(vi.mocked(syncService.list).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(conversationService.list).mock.invocationCallOrder[0] ?? 0)
    expect(syncService.list).toHaveBeenNthCalledWith(2, 4)
    expect(messageService.list).toHaveBeenLastCalledWith('conversation-1', 0)
    expect(messenger.state.messages).toEqual([message])
    expect(messenger.state.syncCursor).toBe(5)
  })
})
