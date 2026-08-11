import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { MessageArchive } from '../app/application/ports/message-archive'
import type { HapticsPort } from '../app/application/ports/haptics'
import type { ClientIdGenerator } from '../app/application/ports/client-id-generator'
import { ListConversationReadStates } from '../app/application/messaging/list-conversation-read-states'
import { MarkConversationRead } from '../app/application/messaging/mark-conversation-read'
import { DeleteMessageForEveryone } from '../app/application/messaging/delete-message-for-everyone'
import { ListParticipantDeliveryStates } from '../app/application/messaging/list-participant-delivery-states'
import { MarkConversationDelivered } from '../app/application/messaging/mark-conversation-delivered'
import type { ConversationReadStateGateway } from '../app/application/ports/conversation-read-state-gateway'
import type { ConversationDeliveryStateGateway } from '../app/application/ports/conversation-delivery-state-gateway'
import type { PageVisibility } from '../app/application/ports/page-visibility'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import { SyntheticMessageProtocol } from '../app/infrastructure/crypto/synthetic-message-protocol'
import { UnavailableMlsMessageProtocol } from '../app/infrastructure/crypto/unavailable-mls-message-protocol'
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
  expiresAt: '2026-09-10T12:00:01Z',
  deletionReason: null,
  deletedAt: null,
}

let gateway: MessagingGateway
let messageArchive: MessageArchive
const haptics: HapticsPort = { isEnabled: () => true, setEnabled: vi.fn(), perform: vi.fn() }
const clientIdGenerator: ClientIdGenerator = { create: () => 'client-generated-id' }
let visible = true
const pageVisibility: PageVisibility = {
  isVisible: () => visible,
  subscribe: () => () => undefined,
}
let readStateGateway: ConversationReadStateGateway
let deliveryStateGateway: ConversationDeliveryStateGateway

function createMessageProtection(): ProtocolMessageProtection {
  return new ProtocolMessageProtection(
    [new SyntheticMessageProtocol(), new UnavailableMlsMessageProtocol()],
    1,
  )
}

beforeEach(() => {
  visible = true
  readStateGateway = {
    list: vi.fn().mockResolvedValue([{
      conversationId: 'conversation-1',
      lastReadSequence: 0,
      latestSequence: 0,
      unreadCount: 0,
    }]),
    mark: vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      lastReadSequence: 1,
      updatedAt: '2026-08-11T12:00:02Z',
      advanced: true,
    }),
  }
  deliveryStateGateway = {
    list: vi.fn().mockResolvedValue([]),
    mark: vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      lastDeliveredSequence: 1,
      updatedAt: '2026-08-11T12:00:02Z',
      advanced: true,
    }),
  }
  messageArchive = {
    loadLatest: vi.fn().mockResolvedValue([]),
    loadBefore: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  }
  gateway = {
    listDirectory: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue([conversation]),
    createDirect: vi.fn(),
    createGroup: vi.fn(),
    listMessages: vi.fn()
      .mockResolvedValueOnce([message])
      .mockResolvedValue([]),
    listMessageHistory: vi.fn().mockResolvedValue({
      messages: [],
      hasMore: false,
      oldestSequence: null,
      newestSequence: null,
    }),
    getMessage: vi.fn().mockResolvedValue(message),
    sendMessage: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      sequence: 1,
      deletionReason: 'manual',
      deletedAt: '2026-08-11T12:01:00Z',
      advanced: true,
    }),
    listSync: vi.fn()
      .mockResolvedValueOnce({ events: [], nextCursor: 4, streamCursor: 4, hasMore: false, resetRequired: false })
      .mockResolvedValueOnce({
        events: [{
          eventId: 'event-5', cursor: 5, eventType: 'message_created',
          conversationId: 'conversation-1', messageId: 'message-1',
          actorUserId: null, readSequence: null, createdAt: '2026-08-11T12:00:01Z',
          deliverySequence: null,
        }],
        nextCursor: 5, streamCursor: 5, hasMore: false, resetRequired: false,
      }),
  }
})

describe('messenger orchestration', () => {
  it('captures a cursor baseline before snapshot and catches up newer messages', async () => {
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    await messenger.poll()

    expect(vi.mocked(gateway.listSync).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(gateway.listConversations).mock.invocationCallOrder[0] ?? 0)
    expect(gateway.listSync).toHaveBeenNthCalledWith(2, 4)
    expect(gateway.listMessages).toHaveBeenLastCalledWith('conversation-1', 0)
    expect(messenger.state.messages).toEqual([{
      ...message,
      contentState: 'available',
      displayBody: 'hello',
      contentSecure: false,
    }])
    expect(messenger.state.syncCursor).toBe(5)
    expect(readStateGateway.mark).toHaveBeenCalledWith('conversation-1', 1)
    expect(deliveryStateGateway.mark).toHaveBeenCalledWith('conversation-1', 1)
    expect(await messenger.send('  hello  ')).toBe(true)
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      'conversation-1',
      'client-generated-id',
      1,
      'aGVsbG8=',
    )
    expect(await messenger.deleteMessage('message-1')).toBe(true)
    expect(gateway.deleteMessage).toHaveBeenCalledWith('conversation-1', 'message-1')
    expect(messenger.state.messages[0]?.ciphertextBase64).toBeNull()
    expect(messenger.state.messages[0]?.deletionReason).toBe('manual')
  })

  it('does not mark a background timeline until the page becomes visible', async () => {
    visible = false
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue([message])
    vi.mocked(gateway.listMessageHistory).mockResolvedValue({
      messages: [message],
      hasMore: false,
      oldestSequence: 1,
      newestSequence: 1,
    })
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    expect(readStateGateway.mark).not.toHaveBeenCalled()
    expect(deliveryStateGateway.mark).toHaveBeenCalledWith('conversation-1', 1)
    visible = true
    await messenger.markActiveRead()
    expect(readStateGateway.mark).toHaveBeenCalledWith('conversation-1', 1)
  })

  it('opens the latest page and loads more than 100 older messages without gaps', async () => {
    const history = Array.from({ length: 205 }, (_, index) => ({
      ...message,
      messageId: `message-${index + 1}`,
      clientMessageId: `client-${index + 1}`,
      sequence: index + 1,
    }))
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(gateway.listMessageHistory).mockImplementation(async (
      _conversationId,
      beforeSequence,
    ) => {
      const candidates = beforeSequence === undefined
        ? history
        : history.filter(item => item.sequence < beforeSequence)
      const page = candidates.slice(-100)
      return {
        messages: page,
        hasMore: candidates.length > page.length,
        oldestSequence: page[0]?.sequence ?? null,
        newestSequence: page.at(-1)?.sequence ?? null,
      }
    })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    expect(messenger.state.messages.map(item => item.sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 106),
    )
    expect(messenger.state.historyHasMore).toBe(true)
    await messenger.loadOlder()
    expect(messenger.state.messages.map(item => item.sequence)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 6),
    )
    await messenger.loadOlder()
    expect(messenger.state.messages.map(item => item.sequence)).toEqual(
      Array.from({ length: 205 }, (_, index) => index + 1),
    )
    expect(messenger.state.historyHasMore).toBe(false)
    expect(gateway.listMessageHistory).toHaveBeenNthCalledWith(
      1, 'conversation-1', undefined, 100,
    )
    expect(gateway.listMessageHistory).toHaveBeenNthCalledWith(
      2, 'conversation-1', 106, 100,
    )
    expect(gateway.listMessageHistory).toHaveBeenNthCalledWith(
      3, 'conversation-1', 6, 100,
    )
    expect(messageArchive.put).toHaveBeenCalledTimes(3)
  })

  it('does not let a stale archive cursor skip server history pages', async () => {
    const page = (start: number) => Array.from({ length: 100 }, (_, index) => ({
      ...message,
      messageId: `message-${start + index}`,
      clientMessageId: `client-${start + index}`,
      sequence: start + index,
    }))
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(messageArchive.loadBefore).mockResolvedValue(page(1))
    vi.mocked(gateway.listMessageHistory)
      .mockResolvedValueOnce({
        messages: page(901), hasMore: true, oldestSequence: 901, newestSequence: 1000,
      })
      .mockResolvedValueOnce({
        messages: page(801), hasMore: true, oldestSequence: 801, newestSequence: 900,
      })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    await messenger.loadOlder()

    expect(gateway.listMessageHistory).toHaveBeenNthCalledWith(
      2, 'conversation-1', 901, 100,
    )
    expect(messageArchive.loadBefore).not.toHaveBeenCalled()
    expect(messenger.state.messages[0]?.sequence).toBe(801)
    expect(messenger.state.messages.at(-1)?.sequence).toBe(1000)
  })

  it('hydrates encrypted cache before network reconciliation and degrades safely', async () => {
    let resolveHistory: ((value: {
      messages: Array<typeof message>
      hasMore: boolean
      oldestSequence: number | null
      newestSequence: number | null
    }) => void) | null = null
    const networkHistory = new Promise<{
      messages: Array<typeof message>
      hasMore: boolean
      oldestSequence: number | null
      newestSequence: number | null
    }>(resolve => { resolveHistory = resolve })
    vi.mocked(messageArchive.loadLatest).mockResolvedValue([message])
    vi.mocked(gateway.listMessageHistory).mockReturnValue(networkHistory)
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    const loading = messenger.load()
    await vi.waitFor(() => expect(messenger.state.messages).toHaveLength(1))
    expect(messenger.state.phase).toBe('ready')
    resolveHistory?.({
      messages: [],
      hasMore: false,
      oldestSequence: null,
      newestSequence: null,
    })
    await loading
    expect(messenger.state.messages).toEqual([])

    vi.mocked(messageArchive.loadLatest).mockRejectedValue(new Error('denied'))
    vi.mocked(gateway.listMessageHistory).mockResolvedValue({
      messages: [], hasMore: false, oldestSequence: null, newestSequence: null,
    })
    const degraded = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })
    await degraded.load()
    expect(degraded.state.phase).toBe('ready')
    expect(degraded.state.archiveStatus).toBe('unavailable')
  })

  it('bounds the reactive history window and can return to the latest page', async () => {
    const history = Array.from({ length: 401 }, (_, index) => ({
      ...message,
      messageId: `bounded-message-${index + 1}`,
      clientMessageId: `bounded-client-${index + 1}`,
      sequence: index + 1,
    }))
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(gateway.listMessageHistory).mockImplementation(async (
      _conversationId,
      beforeSequence,
    ) => {
      const candidates = beforeSequence === undefined
        ? history
        : history.filter(item => item.sequence < beforeSequence)
      const page = candidates.slice(-100)
      return {
        messages: page,
        hasMore: candidates.length > page.length,
        oldestSequence: page[0]?.sequence ?? null,
        newestSequence: page.at(-1)?.sequence ?? null,
      }
    })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    await messenger.loadOlder()
    await messenger.loadOlder()
    await messenger.loadOlder()
    expect(messenger.state.messages).toHaveLength(300)
    expect(messenger.state.messages[0]?.sequence).toBe(2)
    expect(messenger.state.messages.at(-1)?.sequence).toBe(301)
    expect(messenger.state.historyHasNewer).toBe(true)
    await messenger.returnToLatest()
    expect(messenger.state.messages[0]?.sequence).toBe(302)
    expect(messenger.state.messages.at(-1)?.sequence).toBe(401)
    expect(messenger.state.historyHasNewer).toBe(false)
  })

  it('fetches sync tombstones precisely and overwrites the encrypted archive', async () => {
    const tombstone = {
      ...message,
      ciphertextBase64: null,
      deletionReason: 'manual' as const,
      deletedAt: '2026-08-11T12:05:00Z',
    }
    vi.mocked(gateway.listMessageHistory).mockResolvedValue({
      messages: [message], hasMore: false, oldestSequence: 1, newestSequence: 1,
    })
    vi.mocked(gateway.getMessage).mockResolvedValue(tombstone)
    vi.mocked(gateway.listSync).mockReset()
      .mockResolvedValueOnce({
        events: [], nextCursor: 4, streamCursor: 4, hasMore: false, resetRequired: false,
      })
      .mockResolvedValueOnce({
        events: [{
          eventId: 'event-delete',
          cursor: 5,
          eventType: 'message_deleted',
          conversationId: 'conversation-1',
          messageId: 'message-1',
          actorUserId: null,
          readSequence: null,
          deliverySequence: null,
          createdAt: '2026-08-11T12:05:00Z',
        }],
        nextCursor: 5,
        streamCursor: 5,
        hasMore: false,
        resetRequired: false,
      })
    const messenger = useMessenger('alice-id', vi.fn(), {
      gateway,
      messageArchive,
      messageProtection: createMessageProtection(),
      haptics,
      clientIdGenerator,
      listConversationReadStates: new ListConversationReadStates(readStateGateway),
      markConversationRead: new MarkConversationRead(readStateGateway),
      listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
      markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
      deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
      pageVisibility,
    })

    await messenger.load()
    await messenger.poll()

    expect(gateway.getMessage).toHaveBeenCalledWith('conversation-1', 'message-1')
    expect(messenger.state.messages[0]).toMatchObject({
      contentState: 'deleted', ciphertextBase64: null, deletionReason: 'manual',
    })
    expect(messageArchive.put).toHaveBeenLastCalledWith(
      'alice-id',
      'conversation-1',
      [tombstone],
    )
  })
})
