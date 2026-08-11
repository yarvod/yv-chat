import { computed, reactive, readonly } from 'vue'

import { ApplicationError } from '../../application/errors'
import type { ClientIdGenerator } from '../../application/ports/client-id-generator'
import type { ListConversationReadStates } from '../../application/messaging/list-conversation-read-states'
import type { DeleteMessageForEveryone } from '../../application/messaging/delete-message-for-everyone'
import type { ListParticipantDeliveryStates } from '../../application/messaging/list-participant-delivery-states'
import type { MarkConversationDelivered } from '../../application/messaging/mark-conversation-delivered'
import type { MarkConversationRead } from '../../application/messaging/mark-conversation-read'
import type { ProtocolMessageProtection } from '../../application/messaging/message-protection'
import {
  prepareTimelineMessage,
  type TimelineMessage,
} from '../../application/messaging/timeline-message'
import type { HapticsPort } from '../../application/ports/haptics'
import type { MessagingGateway } from '../../application/ports/messaging-gateway'
import type { PageVisibility } from '../../application/ports/page-visibility'
import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'

type MessengerPhase = 'loading' | 'ready' | 'offline' | 'error'

interface MessengerState {
  phase: MessengerPhase
  conversations: Conversation[]
  directory: DirectoryUser[]
  activeConversationId: string | null
  messages: TimelineMessage[]
  readStates: ConversationReadState[]
  deliveryStates: ParticipantDeliveryState[]
  syncCursor: number
  sending: boolean
  creating: boolean
  deletingMessageId: string | null
  message: string | null
}

function sortMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return [...messages].sort((left, right) => left.sequence - right.sequence)
}

export interface MessengerDependencies {
  gateway: MessagingGateway
  messageProtection: ProtocolMessageProtection
  haptics: HapticsPort
  clientIdGenerator: ClientIdGenerator
  listConversationReadStates: ListConversationReadStates
  markConversationRead: MarkConversationRead
  listParticipantDeliveryStates: ListParticipantDeliveryStates
  markConversationDelivered: MarkConversationDelivered
  deleteMessageForEveryone: DeleteMessageForEveryone
  pageVisibility: PageVisibility
}

export function useMessenger(
  actorUserId: string,
  onUnauthorized: () => void,
  suppliedDependencies?: MessengerDependencies,
) {
  const dependencies = suppliedDependencies ?? (() => {
    const { $frontend } = useNuxtApp()
    return {
      gateway: $frontend.messagingGateway,
      messageProtection: $frontend.messageProtection,
      haptics: $frontend.haptics,
      clientIdGenerator: $frontend.clientIdGenerator,
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
    messageProtection,
    haptics,
    clientIdGenerator,
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
    readStates: [],
    deliveryStates: [],
    syncCursor: 0,
    sending: false,
    creating: false,
    deletingMessageId: null,
    message: null,
  })
  let polling = false
  const readAdvances = new Map<string, number>()
  const deliveryAdvances = new Map<string, number>()

  const activeConversation = computed(() => (
    state.conversations.find(item => item.conversationId === state.activeConversationId) ?? null
  ))

  function fail(error: unknown): void {
    if (error instanceof ApplicationError && error.status === 401) {
      onUnauthorized()
      return
    }
    state.phase = error instanceof ApplicationError && error.kind === 'network' ? 'offline' : 'error'
    state.message = state.phase === 'offline'
      ? 'Соединение потеряно. Сообщения на сервер не отправляются.'
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

  async function loadMessages(conversationId: string, afterSequence = 0): Promise<void> {
    const incoming = await gateway.listMessages(conversationId, afterSequence)
    const prepared = await Promise.all(
      incoming.map(message => prepareTimelineMessage(message, messageProtection)),
    )
    if (state.activeConversationId !== conversationId) return
    const known = new Map(state.messages.map(item => [item.messageId, item]))
    for (const item of prepared) known.set(item.messageId, item)
    state.messages = sortMessages([...known.values()])
    await advanceDelivery(conversationId)
    await advanceActiveReadIfVisible()
  }

  async function reloadConversations(): Promise<void> {
    state.conversations = await gateway.listConversations()
    if (!state.conversations.some(item => item.conversationId === state.activeConversationId)) {
      state.activeConversationId = state.conversations[0]?.conversationId ?? null
      state.messages = []
      if (state.activeConversationId) await loadMessages(state.activeConversationId)
    }
  }

  async function load(): Promise<void> {
    state.phase = 'loading'
    state.message = null
    try {
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
      state.messages = []
      if (state.activeConversationId) await loadMessages(state.activeConversationId)
      state.syncCursor = syncBaseline.streamCursor
      state.phase = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  async function selectConversation(conversationId: string): Promise<void> {
    if (conversationId === state.activeConversationId) return
    state.activeConversationId = conversationId
    state.messages = []
    state.message = null
    try {
      await loadMessages(conversationId)
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
    state.sending = true
    state.message = null
    try {
      const clientMessageId = clientIdGenerator.create()
      const protectedMessage = await messageProtection.protectText({
        conversationId,
        clientMessageId,
        plaintext: normalized,
      })
      await gateway.sendMessage(
        conversationId,
        clientMessageId,
        protectedMessage.protocolVersion,
        protectedMessage.ciphertextBase64,
      )
      const lastSequence = state.messages.at(-1)?.sequence ?? 0
      await loadMessages(conversationId, lastSequence)
      haptics.perform('sent')
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.sending = false
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
      let pages = 0
      let hasMore = true
      let conversationsChanged = false
      let activeMessagesChanged = false
      let activeTimelineReset = false
      let readStatesChanged = false
      let deliveryStatesChanged = false
      while (hasMore && pages < 10) {
        const page = await gateway.listSync(state.syncCursor)
        if (page.resetRequired) {
          await reloadConversations()
          if (state.activeConversationId) {
            state.messages = []
            await loadMessages(state.activeConversationId)
          }
          state.syncCursor = page.streamCursor
          state.phase = 'ready'
          return
        }
        for (const event of page.events) {
          conversationsChanged ||= event.eventType === 'conversation_updated'
          activeMessagesChanged ||= (
            event.eventType === 'message_created'
            && event.conversationId === state.activeConversationId
          )
          activeTimelineReset ||= (
            event.eventType === 'message_deleted'
            && event.conversationId === state.activeConversationId
          )
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
      if (activeTimelineReset && state.activeConversationId) {
        state.messages = []
        await loadMessages(state.activeConversationId)
      } else if (activeMessagesChanged && state.activeConversationId) {
        await loadMessages(state.activeConversationId, state.messages.at(-1)?.sequence ?? 0)
      }
      if (readStatesChanged) await reloadReadStates()
      if (deliveryStatesChanged) await reloadDeliveryStates()
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
    activeConversation,
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
    deleteMessage,
    markActiveRead,
  }
}
