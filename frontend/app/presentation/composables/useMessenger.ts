import { computed, reactive, readonly } from 'vue'

import { ApplicationError } from '../../application/errors'
import {
  ConversationHistory,
  type ConversationHistoryWindow,
} from '../../application/messaging/conversation-history'
import type { ListConversationReadStates } from '../../application/messaging/list-conversation-read-states'
import type { DeleteMessageForEveryone } from '../../application/messaging/delete-message-for-everyone'
import type { ListParticipantDeliveryStates } from '../../application/messaging/list-participant-delivery-states'
import type { MarkConversationDelivered } from '../../application/messaging/mark-conversation-delivered'
import type { MarkConversationRead } from '../../application/messaging/mark-conversation-read'
import type { ProtocolMessageProtection } from '../../application/messaging/message-protection'
import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { MessageArchive } from '../../application/ports/message-archive'
import type {
  MessengerSnapshot,
  MessengerSnapshotStore,
} from '../../application/ports/messenger-snapshot-store'
import type { MessagingGateway } from '../../application/ports/messaging-gateway'
import type { PageVisibility } from '../../application/ports/page-visibility'
import type { Clock } from '../../application/ports/clock'
import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
  OpaqueMessage,
  ParticipantDeliveryState,
  SendMessageReceipt,
} from '../../domain/messaging/models'
import type { OutboxMessage } from '../../domain/messaging/outbox'
import {
  useMessageOutbox,
  type MessageOutboxDependencies,
} from './useMessageOutbox'

type MessengerPhase = 'loading' | 'ready' | 'offline' | 'error'

interface MessengerState {
  phase: MessengerPhase
  conversations: Conversation[]
  directory: DirectoryUser[]
  activeConversationId: string | null
  messages: TimelineMessage[]
  historyHasMore: boolean
  historyHasNewer: boolean
  loadingOlder: boolean
  archiveStatus: 'ready' | 'unavailable'
  readStates: ConversationReadState[]
  deliveryStates: ParticipantDeliveryState[]
  syncCursor: number
  creating: boolean
  deletingMessageId: string | null
  message: string | null
}

export interface MessengerDependencies extends MessageOutboxDependencies {
  gateway: MessagingGateway
  messageArchive: MessageArchive
  messengerSnapshotStore: MessengerSnapshotStore
  messageProtection: ProtocolMessageProtection
  clock: Clock
  listConversationReadStates: ListConversationReadStates
  markConversationRead: MarkConversationRead
  listParticipantDeliveryStates: ListParticipantDeliveryStates
  markConversationDelivered: MarkConversationDelivered
  deleteMessageForEveryone: DeleteMessageForEveryone
  pageVisibility: PageVisibility
}

export function useMessenger(
  actorUserId: string,
  actorDeviceId: string,
  onUnauthorized: () => void,
  suppliedDependencies?: MessengerDependencies,
) {
  const dependencies = suppliedDependencies ?? (() => {
    const { $frontend } = useNuxtApp()
    return {
      gateway: $frontend.messagingGateway,
      messageArchive: $frontend.messageArchive,
      messengerSnapshotStore: $frontend.messengerSnapshotStore,
      messageProtection: $frontend.messageProtection,
      clock: $frontend.clock,
      haptics: $frontend.haptics,
      listOutboxMessages: $frontend.listOutboxMessages,
      queueOutgoingMessage: $frontend.queueOutgoingMessage,
      deliverOutboxMessage: $frontend.deliverOutboxMessage,
      acknowledgeOutboxMessage: $frontend.acknowledgeOutboxMessage,
      retryOutboxMessage: $frontend.retryOutboxMessage,
      listConversationReadStates: $frontend.listConversationReadStates,
      markConversationRead: $frontend.markConversationRead,
      listParticipantDeliveryStates: $frontend.listParticipantDeliveryStates,
      markConversationDelivered: $frontend.markConversationDelivered,
      deleteMessageForEveryone: $frontend.deleteMessageForEveryone,
      pageVisibility: $frontend.pageVisibility,
    }
  })()
  const {
    gateway,
    messageArchive,
    messengerSnapshotStore,
    messageProtection,
    clock,
    listConversationReadStates,
    markConversationRead,
    listParticipantDeliveryStates,
    markConversationDelivered,
    deleteMessageForEveryone,
    pageVisibility,
  } = dependencies
  const state = reactive<MessengerState>({
    phase: 'loading',
    conversations: [],
    directory: [],
    activeConversationId: null,
    messages: [],
    historyHasMore: false,
    historyHasNewer: false,
    loadingOlder: false,
    archiveStatus: 'ready',
    readStates: [],
    deliveryStates: [],
    syncCursor: 0,
    creating: false,
    deletingMessageId: null,
    message: null,
  })
  const history = new ConversationHistory(
    actorUserId,
    gateway,
    messageArchive,
    messageProtection,
  )
  let polling = false
  let snapshotAvailable = true
  const readAdvances = new Map<string, number>()
  const deliveryAdvances = new Map<string, number>()

  const activeConversation = computed(() => (
    state.conversations.find(item => item.conversationId === state.activeConversationId) ?? null
  ))
  const outbox = useMessageOutbox(actorUserId, actorDeviceId, dependencies, {
    reconcile: reconcileSent,
    unauthorized: onUnauthorized,
    failed: fail,
  })
  const activeOutgoingMessages = computed(() => outbox.state.messages.filter(message => (
    message.conversationId === state.activeConversationId
  )))

  function fail(error: unknown): void {
    if (error instanceof ApplicationError && error.status === 401) {
      onUnauthorized()
      return
    }
    state.phase = error instanceof ApplicationError && error.kind === 'network' ? 'offline' : 'error'
    state.message = state.phase === 'offline'
      ? outbox.state.status === 'ready'
        ? 'Соединение потеряно. Новые сообщения сохраняются в локальной очереди.'
        : 'Соединение потеряно, локальная очередь отправки недоступна.'
      : 'Не удалось обновить данные мессенджера.'
  }

  function replaceReadState(next: ConversationReadState): void {
    state.readStates = [
      ...state.readStates.filter(item => item.conversationId !== next.conversationId),
      next,
    ]
  }

  async function reloadReadStates(): Promise<void> {
    state.readStates = await listConversationReadStates.execute()
  }

  async function reloadDeliveryStates(): Promise<void> {
    state.deliveryStates = await listParticipantDeliveryStates.execute()
  }

  function replaceDeliveryState(next: ParticipantDeliveryState): void {
    state.deliveryStates = [
      ...state.deliveryStates.filter(item => (
        item.conversationId !== next.conversationId || item.userId !== next.userId
      )),
      next,
    ]
  }

  async function advanceDelivery(conversationId: string): Promise<void> {
    const sequence = state.messages.at(-1)?.sequence ?? 0
    if (sequence <= 0) return
    const persisted = state.deliveryStates.find(item => (
      item.conversationId === conversationId && item.userId === actorUserId
    ))?.deliveredSequence ?? 0
    const submitted = deliveryAdvances.get(conversationId) ?? 0
    if (sequence <= Math.max(persisted, submitted)) return
    deliveryAdvances.set(conversationId, sequence)
    try {
      const result = await markConversationDelivered.execute(conversationId, sequence)
      replaceDeliveryState({
        conversationId,
        userId: actorUserId,
        deliveredSequence: result.lastDeliveredSequence,
      })
    } catch (error) {
      deliveryAdvances.delete(conversationId)
      throw error
    }
  }

  async function advanceActiveReadIfVisible(): Promise<void> {
    const conversationId = state.activeConversationId
    const sequence = state.messages.at(-1)?.sequence ?? 0
    if (!conversationId || sequence <= 0 || !pageVisibility.isVisible()) return
    const persisted = state.readStates.find(item => item.conversationId === conversationId)
      ?.lastReadSequence ?? 0
    const submitted = readAdvances.get(conversationId) ?? 0
    if (sequence <= Math.max(persisted, submitted)) return
    readAdvances.set(conversationId, sequence)
    try {
      const result = await markConversationRead.execute(conversationId, sequence)
      const current = state.readStates.find(item => item.conversationId === conversationId)
      replaceReadState({
        conversationId,
        lastReadSequence: result.lastReadSequence,
        latestSequence: Math.max(current?.latestSequence ?? 0, sequence),
        unreadCount: 0,
      })
    } catch (error) {
      readAdvances.delete(conversationId)
      throw error
    }
  }

  function applyHistoryWindow(window: ConversationHistoryWindow): void {
    state.messages = window.messages
    state.historyHasMore = window.hasMore
    state.historyHasNewer = window.hasNewer
  }

  function syncArchiveStatus(): void {
    state.archiveStatus = history.archiveStatus === 'ready' && snapshotAvailable
      ? 'ready'
      : 'unavailable'
  }

  async function reconcileSent(
    message: OutboxMessage,
    receipt: SendMessageReceipt,
  ): Promise<void> {
    if (message.conversationId === state.activeConversationId) {
      const authoritative: OpaqueMessage = {
        ...receipt,
        ciphertextBase64: message.ciphertextBase64,
        deletionReason: null,
        deletedAt: null,
      }
      const window = await history.acceptAuthoritativeOutgoing(
        authoritative,
        state.messages,
        state.historyHasMore,
        state.historyHasNewer,
      )
      syncArchiveStatus()
      applyHistoryWindow(window)
      await advanceDelivery(message.conversationId)
      await advanceActiveReadIfVisible()
    }
  }

  async function persistSnapshot(): Promise<void> {
    // Never persist an advanced sync cursor when the encrypted message archive is
    // unavailable. Otherwise a later startup could trust that cursor while the
    // corresponding message envelopes were never stored locally.
    if (!snapshotAvailable || history.archiveStatus !== 'ready') return
    try {
      await messengerSnapshotStore.save({
        ownerUserId: actorUserId,
        directory: state.directory,
        conversations: state.conversations,
        readStates: state.readStates,
        deliveryStates: state.deliveryStates,
        syncCursor: state.syncCursor,
        savedAt: new Date(clock.nowMilliseconds()).toISOString(),
      })
    } catch {
      snapshotAvailable = false
      syncArchiveStatus()
    }
  }

  async function hydrateSnapshot(): Promise<boolean> {
    let snapshot: MessengerSnapshot | null
    try {
      snapshot = await messengerSnapshotStore.load(actorUserId)
    } catch {
      snapshotAvailable = false
      syncArchiveStatus()
      return false
    }
    if (!snapshot) return false
    state.directory = [...snapshot.directory]
    state.conversations = [...snapshot.conversations]
    state.readStates = [...snapshot.readStates]
    state.deliveryStates = [...snapshot.deliveryStates]
    state.syncCursor = snapshot.syncCursor
    state.activeConversationId = state.conversations[0]?.conversationId ?? null
    resetHistoryWindow()
    if (state.activeConversationId) {
      const cached = await history.loadCachedLatest(state.activeConversationId)
      syncArchiveStatus()
      if (cached) applyHistoryWindow(cached)
    }
    state.phase = 'ready'
    return true
  }

  async function loadLatestHistory(conversationId: string): Promise<void> {
    let window: ConversationHistoryWindow
    try {
      window = await history.loadLatest(conversationId, cached => {
        syncArchiveStatus()
        if (state.activeConversationId !== conversationId) return
        applyHistoryWindow(cached)
        state.phase = 'ready'
      })
    } finally {
      syncArchiveStatus()
    }
    if (state.activeConversationId !== conversationId) return
    applyHistoryWindow(window)
    await advanceDelivery(conversationId)
    await advanceActiveReadIfVisible()
  }

  async function loadForwardMessages(conversationId: string): Promise<void> {
    let window: ConversationHistoryWindow
    try {
      window = await history.loadForward(
        conversationId,
        state.messages,
        state.historyHasMore,
      )
    } finally {
      syncArchiveStatus()
    }
    if (state.activeConversationId !== conversationId) return
    applyHistoryWindow(window)
    await advanceDelivery(conversationId)
    await advanceActiveReadIfVisible()
  }

  async function loadOlder(): Promise<void> {
    const conversationId = state.activeConversationId
    const beforeSequence = state.messages[0]?.sequence
    if (
      !conversationId
      || beforeSequence === undefined
      || !state.historyHasMore
      || state.loadingOlder
    ) return
    state.loadingOlder = true
    try {
      const window = await history.loadBefore(
        conversationId,
        beforeSequence,
        state.messages,
        state.historyHasNewer,
        cached => {
          if (state.activeConversationId === conversationId) applyHistoryWindow(cached)
        },
      )
      if (state.activeConversationId !== conversationId) return
      applyHistoryWindow(window)
      state.phase = 'ready'
      state.message = null
    } catch (error) {
      fail(error)
    } finally {
      syncArchiveStatus()
      state.loadingOlder = false
    }
  }

  async function returnToLatest(): Promise<void> {
    const conversationId = state.activeConversationId
    if (!conversationId) return
    state.message = null
    try {
      await loadLatestHistory(conversationId)
      state.phase = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  function resetHistoryWindow(): void {
    state.messages = []
    state.historyHasMore = false
    state.historyHasNewer = false
    state.loadingOlder = false
  }

  async function reloadConversations(): Promise<void> {
    const [directory, conversations] = await Promise.all([
      gateway.listDirectory(),
      gateway.listConversations(),
    ])
    state.directory = directory
    state.conversations = conversations
    if (!state.conversations.some(item => item.conversationId === state.activeConversationId)) {
      state.activeConversationId = state.conversations[0]?.conversationId ?? null
      resetHistoryWindow()
      if (state.activeConversationId) await loadLatestHistory(state.activeConversationId)
    }
  }

  async function load(): Promise<void> {
    state.phase = 'loading'
    state.message = null
    try {
      await outbox.load()
      if (await hydrateSnapshot()) {
        await poll()
        if (
          state.activeConversationId
          && state.messages.length === 0
        ) {
          await loadLatestHistory(state.activeConversationId)
        }
        return
      }
      const syncBaseline = await gateway.listSync(0)
      const [directory, conversations, readStates, deliveryStates] = await Promise.all([
        gateway.listDirectory(),
        gateway.listConversations(),
        listConversationReadStates.execute(),
        listParticipantDeliveryStates.execute(),
      ])
      state.directory = directory
      state.conversations = conversations
      state.readStates = readStates
      state.deliveryStates = deliveryStates
      state.activeConversationId = conversations[0]?.conversationId ?? null
      resetHistoryWindow()
      if (state.activeConversationId) await loadLatestHistory(state.activeConversationId)
      state.syncCursor = syncBaseline.streamCursor
      state.phase = 'ready'
      await persistSnapshot()
      await outbox.flush()
    } catch (error) {
      fail(error)
    }
  }

  async function selectConversation(conversationId: string): Promise<void> {
    if (conversationId === state.activeConversationId) return
    state.activeConversationId = conversationId
    resetHistoryWindow()
    state.message = null
    try {
      const cached = await history.loadCachedLatest(conversationId)
      syncArchiveStatus()
      if (cached) {
        applyHistoryWindow(cached)
        state.phase = 'ready'
        await loadForwardMessages(conversationId)
      } else {
        await loadLatestHistory(conversationId)
      }
      state.phase = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  async function createDirect(otherUserId: string): Promise<void> {
    state.creating = true
    state.message = null
    try {
      const conversation = await gateway.createDirect(otherUserId)
      await reloadConversations()
      await selectConversation(conversation.conversationId)
      await persistSnapshot()
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 409) {
        state.message = 'Прямой диалог с этим участником уже существует.'
      } else {
        fail(error)
      }
    } finally {
      state.creating = false
    }
  }

  async function createGroup(title: string, memberUserIds: string[]): Promise<void> {
    state.creating = true
    state.message = null
    try {
      const conversation = await gateway.createGroup(title, memberUserIds)
      await reloadConversations()
      await selectConversation(conversation.conversationId)
      await persistSnapshot()
    } catch (error) {
      fail(error)
    } finally {
      state.creating = false
    }
  }

  async function send(plaintext: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    const normalized = plaintext.trim()
    if (!conversationId || normalized.length === 0 || normalized.length > 4000) return false
    state.message = null
    try {
      return await outbox.enqueue(conversationId, normalized)
    } catch (error) {
      fail(error)
      return false
    }
  }

  async function retryOutgoing(clientMessageId: string): Promise<boolean> {
    try {
      return await outbox.retry(clientMessageId)
    } catch (error) {
      fail(error)
      return false
    }
  }

  async function deleteMessage(messageId: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId || !messageId || state.deletingMessageId !== null) return false
    state.deletingMessageId = messageId
    state.message = null
    try {
      const result = await deleteMessageForEveryone.execute(conversationId, messageId)
      state.messages = state.messages.map(message => (
        message.messageId === result.messageId
          ? {
              ...message,
              ciphertextBase64: null,
              deletionReason: result.deletionReason,
              deletedAt: result.deletedAt,
              contentState: 'deleted' as const,
              displayBody: null,
              contentSecure: false,
            }
          : message
      ))
      const tombstone = state.messages.find(message => message.messageId === result.messageId)
      if (tombstone) {
        await history.persist(conversationId, [tombstone])
        syncArchiveStatus()
      }
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.deletingMessageId = null
    }
  }

  async function poll(): Promise<void> {
    if (polling || state.phase === 'loading') return
    polling = true
    try {
      await outbox.flush()
      let pages = 0
      let hasMore = true
      let conversationsChanged = false
      let activeMessagesChanged = false
      const deletedMessageEvents = new Map<
        string,
        { conversationId: string, messageId: string }
      >()
      let readStatesChanged = false
      let deliveryStatesChanged = false
      while (hasMore && pages < 10) {
        const page = await gateway.listSync(state.syncCursor)
        if (page.resetRequired) {
          await reloadConversations()
          await Promise.all([reloadReadStates(), reloadDeliveryStates()])
          if (state.activeConversationId) {
            resetHistoryWindow()
            await loadLatestHistory(state.activeConversationId)
          }
          state.syncCursor = page.streamCursor
          await persistSnapshot()
          state.phase = 'ready'
          return
        }
        for (const event of page.events) {
          conversationsChanged ||= event.eventType === 'conversation_updated'
          activeMessagesChanged ||= (
            event.eventType === 'message_created'
            && event.conversationId === state.activeConversationId
          )
          if (event.eventType === 'message_deleted' && event.messageId !== null) {
            deletedMessageEvents.set(event.messageId, {
              conversationId: event.conversationId,
              messageId: event.messageId,
            })
          }
          readStatesChanged ||= event.eventType === 'message_created'
            || event.eventType === 'message_deleted'
            || event.eventType === 'read_receipt'
          deliveryStatesChanged ||= event.eventType === 'message_created'
            || event.eventType === 'delivery_receipt'
        }
        state.syncCursor = page.nextCursor
        hasMore = page.hasMore
        pages += 1
      }
      if (conversationsChanged) await reloadConversations()
      for (const event of deletedMessageEvents.values()) {
        let tombstone: TimelineMessage
        try {
          tombstone = await history.fetchTombstone(event.conversationId, event.messageId)
        } finally {
          syncArchiveStatus()
        }
        if (
          event.conversationId === state.activeConversationId
          && state.messages.some(message => message.messageId === event.messageId)
        ) {
          state.messages = state.messages.map(message => (
            message.messageId === event.messageId ? tombstone : message
          ))
        }
      }
      if (activeMessagesChanged && state.activeConversationId) {
        if (!state.historyHasNewer) {
          await loadForwardMessages(state.activeConversationId)
        }
      }
      if (readStatesChanged) await reloadReadStates()
      if (deliveryStatesChanged) await reloadDeliveryStates()
      await persistSnapshot()
      state.phase = 'ready'
      state.message = null
    } catch (error) {
      fail(error)
    } finally {
      polling = false
    }
  }

  async function markActiveRead(): Promise<void> {
    try {
      await advanceActiveReadIfVisible()
    } catch (error) {
      fail(error)
    }
  }

  return {
    state: readonly(state),
    outbox,
    activeConversation,
    activeOutgoingMessages,
    actorUserId,
    protection: {
      secure: messageProtection.secure,
      label: messageProtection.label,
    },
    load,
    poll,
    selectConversation,
    createDirect,
    createGroup,
    send,
    retryOutgoing,
    deleteMessage,
    loadOlder,
    returnToLatest,
    markActiveRead,
  }
}
