import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { AddGroupMember } from '../app/application/conversations/add-group-member'
import { LeaveGroup } from '../app/application/conversations/leave-group'
import { RemoveGroupMember } from '../app/application/conversations/remove-group-member'
import { RenameGroup } from '../app/application/conversations/rename-group'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { MessageArchive } from '../app/application/ports/message-archive'
import type { MessengerSnapshotStore } from '../app/application/ports/messenger-snapshot-store'
import {
  MessageOutboxError,
  type MessageOutbox,
} from '../app/application/ports/message-outbox'
import type { Clock } from '../app/application/ports/clock'
import type { HapticsPort } from '../app/application/ports/haptics'
import type { ClientIdGenerator } from '../app/application/ports/client-id-generator'
import type { OutboxMessage } from '../app/domain/messaging/outbox'
import { ListConversationReadStates } from '../app/application/messaging/list-conversation-read-states'
import { MarkConversationRead } from '../app/application/messaging/mark-conversation-read'
import { DeleteMessageForEveryone } from '../app/application/messaging/delete-message-for-everyone'
import { AcknowledgeOutboxMessage } from '../app/application/messaging/acknowledge-outbox-message'
import { DeliverOutboxMessage } from '../app/application/messaging/deliver-outbox-message'
import { ListOutboxMessages } from '../app/application/messaging/list-outbox-messages'
import { QueueOutgoingMessage } from '../app/application/messaging/queue-outgoing-message'
import { RetryOutboxMessage } from '../app/application/messaging/retry-outbox-message'
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
let messengerSnapshotStore: MessengerSnapshotStore
let messageOutbox: MessageOutbox
const clock: Clock = { nowMilliseconds: () => Date.parse('2026-08-11T12:00:00Z') }
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

function messengerDependencies() {
  return {
    gateway,
    messageArchive,
    messengerSnapshotStore,
    listOutboxMessages: new ListOutboxMessages(messageOutbox),
    queueOutgoingMessage: new QueueOutgoingMessage(
      messageOutbox,
      createMessageProtection(),
      clientIdGenerator,
      clock,
    ),
    deliverOutboxMessage: new DeliverOutboxMessage(messageOutbox, gateway, clock),
    acknowledgeOutboxMessage: new AcknowledgeOutboxMessage(messageOutbox),
    retryOutboxMessage: new RetryOutboxMessage(messageOutbox, clock),
    messageProtection: createMessageProtection(),
    clock,
    haptics,
    clientIdGenerator,
    listConversationReadStates: new ListConversationReadStates(readStateGateway),
    markConversationRead: new MarkConversationRead(readStateGateway),
    listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
    markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
    deleteMessageForEveryone: new DeleteMessageForEveryone(gateway),
    addGroupMember: new AddGroupMember(gateway),
    removeGroupMember: new RemoveGroupMember(gateway),
    renameGroup: new RenameGroup(gateway),
    leaveGroup: new LeaveGroup(gateway),
    pageVisibility,
  }
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
  messengerSnapshotStore = {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  }
  const outboxEntries = new Map<string, OutboxMessage>()
  const outboxKey = (owner: string, device: string, client: string) => (
    `${owner}:${device}:${client}`
  )
  messageOutbox = {
    enqueue: vi.fn(async message => {
      outboxEntries.set(
        outboxKey(message.ownerUserId, message.senderDeviceId, message.clientMessageId),
        message,
      )
    }),
    get: vi.fn(async (ownerUserId, senderDeviceId, clientMessageId) => (
      outboxEntries.get(outboxKey(ownerUserId, senderDeviceId, clientMessageId)) ?? null
    )),
    list: vi.fn(async (ownerUserId, senderDeviceId) => [...outboxEntries.values()].filter(
      entry => entry.ownerUserId === ownerUserId && entry.senderDeviceId === senderDeviceId,
    )),
    replace: vi.fn(async message => {
      outboxEntries.set(
        outboxKey(message.ownerUserId, message.senderDeviceId, message.clientMessageId),
        message,
      )
    }),
    remove: vi.fn(async (ownerUserId, senderDeviceId, clientMessageId) => {
      outboxEntries.delete(outboxKey(ownerUserId, senderDeviceId, clientMessageId))
    }),
    close: vi.fn(),
  }
  gateway = {
    listDirectory: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue([conversation]),
    createDirect: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    leaveGroup: vi.fn(),
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
    sendMessage: vi.fn().mockResolvedValue({
      messageId: 'message-sent',
      clientMessageId: 'client-generated-id',
      conversationId: 'conversation-1',
      senderUserId: 'alice-id',
      senderDeviceId: 'device-alice',
      protocolVersion: 1,
      sequence: 2,
      createdAt: '2026-08-11T12:00:03Z',
      expiresAt: '2026-09-10T12:00:03Z',
    }),
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
  it('applies a group mutation immediately and persists the encrypted snapshot', async () => {
    const group = {
      ...conversation,
      conversationType: 'group' as const,
      title: 'Old title',
      members: [{
        userId: 'alice-id', username: 'alice', displayName: 'Alice',
        role: 'owner' as const, joinedAt: conversation.createdAt, leftAt: null,
      }],
    }
    const renamed = { ...group, title: 'New title', updatedAt: '2026-08-11T12:01:00Z' }
    vi.mocked(gateway.listConversations).mockResolvedValue([group])
    vi.mocked(gateway.renameGroup).mockResolvedValue(renamed)
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await messenger.load()

    expect(await messenger.renameActiveGroup(' New title ')).toBe(true)
    expect(gateway.renameGroup).toHaveBeenCalledWith('conversation-1', 'New title')
    expect(messenger.activeConversation.value?.title).toBe('New title')
    expect(messengerSnapshotStore.save).toHaveBeenCalledWith(expect.objectContaining({
      conversations: [renamed],
    }))
  })

  it('never bypasses durable enqueue when local storage is full', async () => {
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(messageOutbox.enqueue).mockRejectedValue(new MessageOutboxError('queue-full'))
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await messenger.load()

    expect(await messenger.send('must remain a draft')).toBe(false)
    expect(gateway.sendMessage).not.toHaveBeenCalled()
    expect(messenger.outbox.state.notice).toContain('очередь заполнена')
  })

  it('keeps an offline envelope and recovers the exact idempotency key after restart', async () => {
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(gateway.sendMessage)
      .mockReset()
      .mockRejectedValueOnce(new ApplicationError(null, 'network', 'offline'))
      .mockResolvedValueOnce({
        messageId: 'message-recovered',
        clientMessageId: 'client-generated-id',
        conversationId: 'conversation-1',
        senderUserId: 'alice-id',
        senderDeviceId: 'device-alice',
        protocolVersion: 1,
        sequence: 2,
        createdAt: '2026-08-11T12:00:03Z',
        expiresAt: '2026-09-10T12:00:03Z',
      })
    const first = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await first.load()

    expect(await first.send('offline body')).toBe(true)
    await vi.waitFor(() => expect(first.outbox.state.messages[0]).toMatchObject({
      clientMessageId: 'client-generated-id', status: 'pending', attemptCount: 1,
    }))
    const persisted = await messageOutbox.get(
      'alice-id',
      'device-alice',
      'client-generated-id',
    )
    expect(persisted?.ciphertextBase64).toBe('b2ZmbGluZSBib2R5')

    if (!persisted) throw new Error('outbox entry was not persisted')
    await messageOutbox.replace({
      ...persisted,
      status: 'sending',
      nextAttemptAt: null,
      updatedAt: '2026-08-11T12:00:02Z',
    })
    const restarted = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await restarted.load()

    expect(gateway.sendMessage).toHaveBeenNthCalledWith(
      1, 'conversation-1', 'client-generated-id', 1, 'b2ZmbGluZSBib2R5',
    )
    expect(gateway.sendMessage).toHaveBeenNthCalledWith(
      2, 'conversation-1', 'client-generated-id', 1, 'b2ZmbGluZSBib2R5',
    )
    expect(restarted.outbox.state.messages).toEqual([])
    expect(restarted.state.messages.at(-1)).toMatchObject({
      messageId: 'message-recovered', clientMessageId: 'client-generated-id',
    })
    await expect(messageOutbox.get(
      'alice-id',
      'device-alice',
      'client-generated-id',
    )).resolves.toBeNull()
  })

  it('hydrates a local conversation snapshot and catches up without full list refetch', async () => {
    vi.mocked(messengerSnapshotStore.load).mockResolvedValue({
      ownerUserId: 'alice-id',
      directory: [],
      conversations: [conversation],
      readStates: [],
      deliveryStates: [],
      syncCursor: 8,
      savedAt: '2026-08-11T11:59:00Z',
    })
    vi.mocked(messageArchive.loadLatest).mockResolvedValue([message])
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 8, streamCursor: 8, hasMore: false, resetRequired: false,
    })
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

    await messenger.load()

    expect(messenger.state.phase).toBe('ready')
    expect(messenger.state.conversations).toEqual([conversation])
    expect(messenger.state.messages[0]).toMatchObject({
      messageId: 'message-1', displayBody: 'hello',
    })
    expect(gateway.listSync).toHaveBeenCalledWith(8)
    expect(gateway.listDirectory).not.toHaveBeenCalled()
    expect(gateway.listConversations).not.toHaveBeenCalled()
    expect(gateway.listMessageHistory).not.toHaveBeenCalled()
    expect(readStateGateway.list).not.toHaveBeenCalled()
    expect(deliveryStateGateway.list).not.toHaveBeenCalled()
    expect(messengerSnapshotStore.save).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'alice-id', syncCursor: 8,
    }))
  })

  it('captures a cursor baseline before snapshot and catches up newer messages', async () => {
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    await vi.waitFor(() => expect(gateway.sendMessage).toHaveBeenCalledWith(
      'conversation-1', 'client-generated-id', 1, 'aGVsbG8=',
    ))
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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    vi.mocked(messengerSnapshotStore.save).mockClear()
    const degraded = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await degraded.load()
    expect(degraded.state.phase).toBe('ready')
    expect(degraded.state.archiveStatus).toBe('unavailable')
    expect(messengerSnapshotStore.save).not.toHaveBeenCalled()
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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

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
