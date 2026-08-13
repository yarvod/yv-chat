import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { AddGroupMember } from '../app/application/conversations/add-group-member'
import { LeaveGroup } from '../app/application/conversations/leave-group'
import { RemoveGroupMember } from '../app/application/conversations/remove-group-member'
import { RenameGroup } from '../app/application/conversations/rename-group'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { AttachmentGateway } from '../app/application/ports/attachment-gateway'
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
import { UploadGroupAttachment } from '../app/application/messaging/upload-group-attachment'
import { decodeGroupMessageContent } from '../app/application/messaging/group-message-content'
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
  conversationType: 'group' as const,
  title: 'Test group',
  createdBy: 'alice-id',
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  members: [{
    userId: 'alice-id', username: 'alice', displayName: 'Alice',
    role: 'owner' as const, joinedAt: '2026-08-11T12:00:00Z', leftAt: null,
  }],
}

const message = {
  messageId: 'message-1',
  clientMessageId: 'client-1',
  conversationId: 'conversation-1',
  senderUserId: 'bob-id',
  senderDeviceId: 'device-1',
    protocolVersion: 1,
    cryptoGenerationId: null,
    cryptoEpoch: null,
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
    loadAfter: vi.fn().mockResolvedValue([]),
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
      cryptoGenerationId: null,
      cryptoEpoch: null,
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
  it('keeps groups usable without invoking MLS reconciliation and labels the downgrade', async () => {
    const reconcileConversationCrypto = vi.fn()
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
    })

    await messenger.load()

    expect(reconcileConversationCrypto).not.toHaveBeenCalled()
    expect(messenger.protection.secure.value).toBe(false)
    expect(messenger.protection.label.value).toContain('без E2EE')
    expect(messenger.protection.label.value).toContain('доступны серверу')
  })

  it('loads and sends in a group when the local OpenMLS module is unavailable', async () => {
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      initializeDeviceCrypto: vi.fn().mockRejectedValue(new Error('worker unavailable')),
      reconcileConversationCrypto: vi.fn(),
    })

    await messenger.load()

    expect(messenger.state.phase).toBe('ready')
    expect(await messenger.send('group stays available')).toBe(true)
    await vi.waitFor(() => expect(gateway.sendMessage).toHaveBeenCalledWith(
      'conversation-1', 'client-generated-id', 1, 'Z3JvdXAgc3RheXMgYXZhaWxhYmxl',
      null, null,
    ))
  })

  it('uploads an ordered batch and binds all attachment IDs to one message', async () => {
    let uploadIndex = 0
    const upload = vi.fn(async (conversationId, source) => ({
      attachmentId: `server-${uploadIndex++}`,
      clientAttachmentId: source.clientAttachmentId,
      conversationId,
      kind: source.kind,
      contentType: source.contentType,
      byteSize: source.byteSize,
      sha256Digest: 'a'.repeat(64),
      createdAt: '2026-08-11T12:00:00Z',
      expiresAt: '2026-09-10T12:00:00Z',
    }))
    let clientIndex = 0
    const uploadGroupAttachment = new UploadGroupAttachment(
      { upload, download: vi.fn() },
      { create: () => `upload-client-${clientIndex++}` },
    )
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      uploadGroupAttachment,
    })
    const sources = Array.from({ length: 10 }, (_, index) => {
      const body = new Blob([`photo-${index}`], { type: 'image/png' })
      return {
        name: `photo-${index}.png`,
        type: 'image/png',
        size: body.size,
        body,
      }
    })

    await messenger.load()
    expect(await messenger.send('album', sources)).toBe(true)
    expect(upload).toHaveBeenCalledTimes(10)
    expect(upload.mock.calls.map(call => call[1].clientAttachmentId)).toEqual(
      sources.map((_, index) => `upload-client-${index}`),
    )
    await vi.waitFor(() => expect(gateway.sendMessage).toHaveBeenCalled())
    const call = vi.mocked(gateway.sendMessage).mock.calls.at(-1)
    expect(call?.[6]).toEqual(sources.map((_, index) => `server-${index}`))
    const plaintext = atob(call?.[3] ?? '')
    expect(decodeGroupMessageContent(plaintext).attachments.map(item => item.name)).toEqual(
      sources.map(item => item.name),
    )
  })

  it('aggregates monotonic byte progress across sequential attachment uploads', async () => {
    const snapshots: Array<{ sent: number; total: number; completed: number }> = []
    const upload = vi.fn<AttachmentGateway['upload']>(async (
      conversationId,
      source,
      onProgress,
    ) => {
      onProgress?.({
        uploadedBytes: Math.floor(source.byteSize / 2),
        totalBytes: source.byteSize,
      })
      snapshots.push({
        sent: messenger.state.attachmentUploadBytesSent,
        total: messenger.state.attachmentUploadBytesTotal,
        completed: messenger.state.attachmentUploadCompleted,
      })
      return {
        attachmentId: `server-${source.clientAttachmentId}`,
        clientAttachmentId: source.clientAttachmentId,
        conversationId,
        kind: source.kind,
        contentType: source.contentType,
        byteSize: source.byteSize,
        sha256Digest: 'a'.repeat(64),
        createdAt: '2026-08-11T12:00:00Z',
        expiresAt: '2026-09-10T12:00:00Z',
      }
    })
    let clientIndex = 0
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      uploadGroupAttachment: new UploadGroupAttachment(
        { upload, download: vi.fn() },
        { create: () => `progress-${clientIndex++}` },
      ),
    })
    const first = new Blob(['1234'], { type: 'application/octet-stream' })
    const second = new Blob(['123456'], { type: 'application/octet-stream' })

    await messenger.load()
    await expect(messenger.send('', [
      { name: 'first.bin', type: first.type, size: first.size, body: first },
      { name: 'second.bin', type: second.type, size: second.size, body: second },
    ])).resolves.toBe(true)

    expect(snapshots).toEqual([
      { sent: 2, total: 10, completed: 0 },
      { sent: 7, total: 10, completed: 1 },
    ])
    expect(messenger.state).toMatchObject({
      uploadingAttachment: false,
      attachmentUploadCompleted: 0,
      attachmentUploadTotal: 0,
      attachmentUploadBytesSent: 0,
      attachmentUploadBytesTotal: 0,
    })
  })

  it('keeps a failed batch retryable with stable upload idempotency IDs', async () => {
    let failSecond = true
    const upload = vi.fn(async (conversationId, source) => {
      if (source.clientAttachmentId === 'batch-client-1' && failSecond) {
        failSecond = false
        throw new ApplicationError(null, 'network', 'network unavailable')
      }
      return {
        attachmentId: `server-${source.clientAttachmentId}`,
        clientAttachmentId: source.clientAttachmentId,
        conversationId,
        kind: source.kind,
        contentType: source.contentType,
        byteSize: source.byteSize,
        sha256Digest: 'a'.repeat(64),
        createdAt: '2026-08-11T12:00:00Z',
        expiresAt: '2026-09-10T12:00:00Z',
      }
    })
    let clientIndex = 0
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      uploadGroupAttachment: new UploadGroupAttachment(
        { upload, download: vi.fn() },
        { create: () => `batch-client-${clientIndex++}` },
      ),
    })
    const sources = Array.from({ length: 3 }, (_, index) => {
      const body = new Blob([`file-${index}`], { type: 'text/plain' })
      return { name: `file-${index}.txt`, type: body.type, size: body.size, body }
    })

    await messenger.load()
    expect(await messenger.send('', sources)).toBe(false)
    expect(messenger.state.message).toContain('повторите')
    expect(await messenger.send('', sources)).toBe(true)
    expect(upload.mock.calls.map(call => call[1].clientAttachmentId)).toEqual([
      'batch-client-0',
      'batch-client-1',
      'batch-client-0',
      'batch-client-1',
      'batch-client-2',
    ])
    await vi.waitFor(() => expect(gateway.sendMessage).toHaveBeenCalled())
    expect(vi.mocked(gateway.sendMessage).mock.calls.at(-1)?.[6]).toEqual([
      'server-batch-client-0',
      'server-batch-client-1',
      'server-batch-client-2',
    ])
  })

  it('keeps direct send fail-closed while MLS reconciliation is pending', async () => {
    const direct = { ...conversation, conversationType: 'direct' as const, title: null }
    vi.mocked(gateway.listConversations).mockResolvedValue([direct])
    const reconcileConversationCrypto = vi.fn().mockResolvedValue({
      status: 'pending' as const,
      generation: null,
      blockReason: null,
    })
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
    })

    await messenger.load()

    expect(reconcileConversationCrypto).toHaveBeenCalledWith('conversation-1')
    expect(await messenger.send('must not downgrade')).toBe(false)
    expect(gateway.sendMessage).not.toHaveBeenCalled()
    expect(messenger.state.message).toContain('MLS E2EE')
  })

  it('explains that a new device waits for an existing MLS leaf and stays fail-closed', async () => {
    const direct = { ...conversation, conversationType: 'direct' as const, title: null }
    vi.mocked(gateway.listConversations).mockResolvedValue([direct])
    const reconcileConversationCrypto = vi.fn().mockResolvedValue({
      status: 'blocked' as const,
      generationId: 'generation-roster-change',
      generationNumber: 2,
      blockReason: 'device_roster_changed',
      epoch: null,
    })
    const messenger = useMessenger('alice-id', 'device-new-phone', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
    })

    await messenger.load()

    expect(messenger.protection.secure.value).toBe(false)
    expect(messenger.protection.label.value)
      .toBe('Ожидаем подтверждение от уже подключённого устройства')
    expect(await messenger.send('must wait for an old leaf')).toBe(false)
    expect(gateway.sendMessage).not.toHaveBeenCalled()
  })

  it('reconciles inactive direct conversations during startup', async () => {
    const directs = [
      { ...conversation, conversationId: 'direct-active', conversationType: 'direct' as const, title: null },
      { ...conversation, conversationId: 'direct-inactive', conversationType: 'direct' as const, title: null },
    ]
    vi.mocked(gateway.listConversations).mockResolvedValue(directs)
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue([])
    const reconcileConversationCrypto = vi.fn().mockResolvedValue({
      status: 'ready' as const,
      generationId: 'generation-ready',
      generationNumber: 2,
      blockReason: null,
      epoch: 2,
    })
    const messenger = useMessenger('alice-id', 'device-existing-leaf', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
    })

    await messenger.load('direct-active')

    expect(reconcileConversationCrypto).toHaveBeenCalledWith('direct-inactive')
  })

  it('caches retained direct history before advancing its MLS generation', async () => {
    const directs = [
      { ...conversation, conversationId: 'direct-active', conversationType: 'direct' as const, title: null },
      { ...conversation, conversationId: 'direct-inactive', conversationType: 'direct' as const, title: null },
    ]
    vi.mocked(gateway.listConversations).mockResolvedValue(directs)
    const order: string[] = []
    vi.mocked(gateway.listMessages).mockImplementation(async (conversationId) => {
      order.push(`drain:${conversationId}`)
      return []
    })
    let drainBeforeAdvance: ((conversationId: string) => Promise<void>) | undefined
    const reconcileConversationCrypto = vi.fn(async (conversationId: string) => {
      await drainBeforeAdvance?.(conversationId)
      order.push(`reconcile:${conversationId}`)
      return {
        status: 'ready' as const,
        generationId: `generation-${conversationId}`,
        generationNumber: 2,
        blockReason: null,
        epoch: 2,
      }
    })
    const messenger = useMessenger('alice-id', 'device-existing-leaf', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
      configureCryptoEpochDrainer: drainer => {
        drainBeforeAdvance = drainer
      },
    })

    await messenger.load('direct-active')

    expect(order.indexOf('drain:direct-active'))
      .toBeLessThan(order.indexOf('reconcile:direct-active'))
    expect(order.indexOf('drain:direct-inactive'))
      .toBeLessThan(order.indexOf('reconcile:direct-inactive'))
  })

  it('reconciles an inactive direct after its durable roster-change event', async () => {
    const directs = [
      { ...conversation, conversationId: 'direct-active', conversationType: 'direct' as const, title: null },
      { ...conversation, conversationId: 'direct-inactive', conversationType: 'direct' as const, title: null },
    ]
    vi.mocked(gateway.listConversations).mockResolvedValue(directs)
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue([])
    const reconcileConversationCrypto = vi.fn().mockResolvedValue({
      status: 'ready' as const,
      generationId: 'generation-ready',
      generationNumber: 2,
      blockReason: null,
      epoch: 2,
    })
    const invalidateConversationCrypto = vi.fn()
    const messenger = useMessenger('alice-id', 'device-existing-leaf', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
      invalidateConversationCrypto,
    })
    await messenger.load('direct-active')
    reconcileConversationCrypto.mockClear()
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [{
        eventId: 'event-roster-change',
        cursor: 5,
        eventType: 'conversation_updated',
        conversationId: 'direct-inactive',
        messageId: null,
        actorUserId: null,
        readSequence: null,
        deliverySequence: null,
        createdAt: '2026-08-12T14:33:33Z',
      }],
      nextCursor: 5,
      streamCursor: 5,
      hasMore: false,
      resetRequired: false,
    })

    await messenger.poll()

    expect(invalidateConversationCrypto).toHaveBeenCalledWith('direct-inactive')
    expect(reconcileConversationCrypto).toHaveBeenCalledWith('direct-inactive')
    expect(reconcileConversationCrypto).not.toHaveBeenCalledWith('direct-active')
  })

  it('refreshes a direct security badge after message catch-up completes enrollment', async () => {
    const direct = { ...conversation, conversationType: 'direct' as const, title: null }
    vi.mocked(gateway.listConversations).mockResolvedValue([direct])
    const reconcileConversationCrypto = vi.fn()
      .mockResolvedValueOnce({
        status: 'pending' as const,
        generationId: 'generation-1',
        generationNumber: 1,
        blockReason: null,
        epoch: null,
      })
      .mockResolvedValueOnce({
        status: 'ready' as const,
        generationId: 'generation-1',
        generationNumber: 1,
        blockReason: null,
        epoch: 1,
      })
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), {
      ...messengerDependencies(),
      reconcileConversationCrypto,
    })

    await messenger.load()
    expect(messenger.protection.secure.value).toBe(false)
    await messenger.poll()

    expect(reconcileConversationCrypto).toHaveBeenCalledTimes(2)
    expect(messenger.protection.secure.value).toBe(true)
    expect(messenger.protection.label.value).toBe('MLS E2EE готово')
  })

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
        cryptoGenerationId: null,
        cryptoEpoch: null,
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
      null, null,
    )
    expect(gateway.sendMessage).toHaveBeenNthCalledWith(
      2, 'conversation-1', 'client-generated-id', 1, 'b2ZmbGluZSBib2R5',
      null, null,
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

  it('restores an already opened conversation synchronously from a bounded hot window', async () => {
    const secondConversation = {
      ...conversation,
      conversationId: 'conversation-2',
      title: 'Second group',
    }
    const secondMessage = {
      ...message,
      messageId: 'message-2',
      clientMessageId: 'client-2',
      conversationId: 'conversation-2',
      sequence: 2,
    }
    vi.mocked(gateway.listConversations).mockResolvedValue([conversation, secondConversation])
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 0, streamCursor: 0, hasMore: false, resetRequired: false,
    })
    vi.mocked(gateway.listMessageHistory).mockImplementation(async conversationId => ({
      messages: [conversationId === 'conversation-1' ? message : secondMessage],
      hasMore: false,
      oldestSequence: conversationId === 'conversation-1' ? 1 : 2,
      newestSequence: conversationId === 'conversation-1' ? 1 : 2,
    }))
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue([])
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

    await messenger.load()
    await messenger.selectConversation('conversation-2')
    expect(messenger.state.messages[0]?.messageId).toBe('message-2')

    let releaseCatchUp: ((messages: Array<typeof message>) => void) | null = null
    vi.mocked(gateway.listMessages).mockImplementation((conversationId) => (
      conversationId === 'conversation-1'
        ? new Promise(resolve => { releaseCatchUp = resolve })
        : Promise.resolve([])
    ))
    const archiveReadsBeforeReturn = vi.mocked(messageArchive.loadLatest).mock.calls.length
    const returning = messenger.selectConversation('conversation-1')

    expect(messenger.state.activeConversationId).toBe('conversation-1')
    expect(messenger.state.messages[0]).toMatchObject({
      messageId: 'message-1',
      displayBody: 'hello',
    })
    expect(messageArchive.loadLatest).toHaveBeenCalledTimes(archiveReadsBeforeReturn)
    releaseCatchUp?.([])
    await returning
    expect(messenger.state.messages[0]?.messageId).toBe('message-1')
  })

  it('paints an anchored local archive window before server reconciliation finishes', async () => {
    const secondConversation = {
      ...conversation,
      conversationId: 'conversation-2',
      title: 'Second group',
    }
    const secondMessage = {
      ...message,
      messageId: 'message-2',
      clientMessageId: 'client-2',
      conversationId: 'conversation-2',
      sequence: 2,
    }
    const anchoredMessage = {
      ...message,
      messageId: 'message-anchor',
      clientMessageId: 'client-anchor',
      sequence: 42,
    }
    vi.mocked(messengerSnapshotStore.load).mockResolvedValue({
      ownerUserId: 'alice-id',
      directory: [],
      conversations: [conversation, secondConversation],
      readStates: [],
      deliveryStates: [],
      viewportAnchors: [{
        conversationId: 'conversation-1',
        messageId: 'message-anchor',
        sequence: 42,
        offset: 28,
        atLatest: false,
        savedAt: '2026-08-11T12:45:00Z',
      }],
      syncCursor: 8,
      savedAt: '2026-08-11T11:59:00Z',
    })
    vi.mocked(messageArchive.loadLatest).mockImplementation(async (_owner, conversationId) => (
      conversationId === 'conversation-2' ? [secondMessage] : []
    ))
    vi.mocked(messageArchive.loadBefore).mockResolvedValue([anchoredMessage])
    vi.mocked(messageArchive.loadAfter).mockResolvedValue(Array.from(
      { length: 51 },
      (_, index) => ({
        ...message,
        messageId: `message-after-${index + 43}`,
        clientMessageId: `client-after-${index + 43}`,
        sequence: index + 43,
      }),
    ))
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue(Array.from(
      { length: 51 },
      (_, index) => ({
        ...message,
        messageId: `message-after-${index + 43}`,
        clientMessageId: `client-after-${index + 43}`,
        sequence: index + 43,
      }),
    ))
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 8, streamCursor: 8, hasMore: false, resetRequired: false,
    })
    let releaseNetwork: ((value: {
      messages: Array<typeof message>
      hasMore: boolean
      oldestSequence: number | null
      newestSequence: number | null
    }) => void) | null = null
    vi.mocked(gateway.listMessageHistory).mockReturnValue(new Promise(resolve => {
      releaseNetwork = resolve
    }))
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())
    await messenger.load('conversation-2')

    let settled = false
    const selecting = messenger.selectConversation('conversation-1').finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(messenger.state.messages[0]?.messageId).toBe('message-anchor'))
    expect(messenger.state.historyHasNewer).toBe(true)
    expect(settled).toBe(false)
    expect(messageArchive.loadBefore).toHaveBeenCalledWith('alice-id', 'conversation-1', 43, 50)
    expect(messageArchive.loadAfter).toHaveBeenCalledWith('alice-id', 'conversation-1', 42, 51)

    releaseNetwork?.({
      messages: [anchoredMessage],
      hasMore: true,
      oldestSequence: 42,
      newestSequence: 42,
    })
    await selecting
    expect(messenger.state.messages[0]?.messageId).toBe('message-anchor')
  })

  it('hydrates the saved window instead of briefly painting the latest page on startup', async () => {
    const anchoredMessage = {
      ...message,
      messageId: 'message-anchor',
      clientMessageId: 'client-anchor',
      sequence: 500,
    }
    const latestMessage = {
      ...message,
      messageId: 'message-latest',
      clientMessageId: 'client-latest',
      sequence: 1_000,
    }
    vi.mocked(messengerSnapshotStore.load).mockResolvedValue({
      ownerUserId: 'alice-id',
      directory: [],
      conversations: [conversation],
      readStates: [],
      deliveryStates: [],
      viewportAnchors: [{
        conversationId: 'conversation-1',
        messageId: 'message-anchor',
        sequence: 500,
        offset: 24,
        atLatest: false,
        savedAt: '2026-08-11T12:45:00Z',
      }],
      syncCursor: 8,
      savedAt: '2026-08-11T11:59:00Z',
    })
    vi.mocked(messageArchive.loadLatest).mockResolvedValue([latestMessage])
    vi.mocked(messageArchive.loadBefore).mockResolvedValue([anchoredMessage])
    vi.mocked(messageArchive.loadAfter).mockResolvedValue(Array.from(
      { length: 51 },
      (_, index) => ({
        ...message,
        messageId: `message-after-${index + 501}`,
        clientMessageId: `client-after-${index + 501}`,
        sequence: index + 501,
      }),
    ))
    vi.mocked(gateway.listSync).mockReset().mockResolvedValue({
      events: [], nextCursor: 8, streamCursor: 8, hasMore: false, resetRequired: false,
    })
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

    await messenger.load('conversation-1')

    expect(messageArchive.loadLatest).not.toHaveBeenCalled()
    expect(messageArchive.loadBefore).toHaveBeenCalledWith(
      'alice-id', 'conversation-1', 501, 50,
    )
    expect(messenger.state.messages[0]?.messageId).toBe('message-anchor')
    expect(messenger.state.messages.at(-1)?.sequence).toBe(550)
    expect(messenger.state.historyHasNewer).toBe(true)
  })

  it('loads an exact deep-linked message window and persists its encrypted viewport anchor', async () => {
    const target = {
      ...message,
      messageId: 'message-target',
      clientMessageId: 'client-target',
      sequence: 42,
      createdAt: '2026-08-11T12:42:00Z',
    }
    vi.mocked(gateway.getMessage).mockResolvedValue(target)
    vi.mocked(gateway.listMessageHistory).mockImplementation(async (
      _conversationId,
      beforeSequence,
    ) => ({
      messages: beforeSequence === 42 ? [{ ...message, sequence: 41 }] : [],
      hasMore: beforeSequence === 42,
      oldestSequence: beforeSequence === 42 ? 41 : null,
      newestSequence: beforeSequence === 42 ? 41 : null,
    }))
    vi.mocked(gateway.listMessages).mockReset().mockResolvedValue(Array.from(
      { length: 51 },
      (_, index) => ({
        ...message,
        messageId: `message-after-${index + 43}`,
        clientMessageId: `client-after-${index + 43}`,
        sequence: index + 43,
      }),
    ))
    const messenger = useMessenger('alice-id', 'device-alice', vi.fn(), messengerDependencies())

    await messenger.load('conversation-1', 'message-target')

    expect(gateway.getMessage).toHaveBeenCalledWith('conversation-1', 'message-target')
    expect(messenger.state.messages.find(item => item.messageId === 'message-target')).toMatchObject({
      messageId: 'message-target',
      sequence: 42,
    })
    expect(messenger.state.messages.at(-1)?.sequence).toBe(92)
    expect(messenger.state.historyHasNewer).toBe(true)

    await messenger.rememberViewport({
      conversationId: 'conversation-1',
      messageId: 'message-target',
      sequence: 42,
      offset: 24,
      atLatest: false,
      savedAt: '2026-08-11T12:43:00Z',
    })
    expect(messenger.activeViewportAnchor.value).toMatchObject({
      messageId: 'message-target',
      sequence: 42,
      offset: 24,
    })
    expect(messengerSnapshotStore.save).toHaveBeenLastCalledWith(expect.objectContaining({
      viewportAnchors: [expect.objectContaining({ messageId: 'message-target' })],
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
      null, null,
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
