import { computed, reactive, readonly } from 'vue'

import { ApiError } from '../services/api'
import {
  conversationService,
  directoryService,
  messageService,
  syncService,
} from '../services/messaging/api'
import { syntheticMessageCodec } from '../services/messaging/syntheticCodec'
import type { Conversation, DirectoryUser, OpaqueMessage } from '../services/messaging/types'

type MessengerPhase = 'loading' | 'ready' | 'offline' | 'error'

interface MessengerState {
  phase: MessengerPhase
  conversations: Conversation[]
  directory: DirectoryUser[]
  activeConversationId: string | null
  messages: OpaqueMessage[]
  syncCursor: number
  sending: boolean
  creating: boolean
  message: string | null
}

function sortMessages(messages: OpaqueMessage[]): OpaqueMessage[] {
  return [...messages].sort((left, right) => left.sequence - right.sequence)
}

export function useMessenger(actorUserId: string, onUnauthorized: () => void) {
  const state = reactive<MessengerState>({
    phase: 'loading',
    conversations: [],
    directory: [],
    activeConversationId: null,
    messages: [],
    syncCursor: 0,
    sending: false,
    creating: false,
    message: null,
  })
  let polling = false

  const activeConversation = computed(() => (
    state.conversations.find(item => item.conversationId === state.activeConversationId) ?? null
  ))

  function fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized()
      return
    }
    state.phase = error instanceof ApiError && error.kind === 'network' ? 'offline' : 'error'
    state.message = state.phase === 'offline'
      ? 'Соединение потеряно. Сообщения на сервер не отправляются.'
      : 'Не удалось обновить данные мессенджера.'
  }

  async function loadMessages(conversationId: string, afterSequence = 0): Promise<void> {
    const incoming = await messageService.list(conversationId, afterSequence)
    if (state.activeConversationId !== conversationId) return
    const known = new Map(state.messages.map(item => [item.messageId, item]))
    for (const item of incoming) known.set(item.messageId, item)
    state.messages = sortMessages([...known.values()])
  }

  async function reloadConversations(): Promise<void> {
    state.conversations = await conversationService.list()
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
      const syncBaseline = await syncService.list(0)
      const [directory, conversations] = await Promise.all([
        directoryService.list(),
        conversationService.list(),
      ])
      state.directory = directory
      state.conversations = conversations
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
      const conversation = await conversationService.createDirect(otherUserId)
      await reloadConversations()
      await selectConversation(conversation.conversationId)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
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
      const conversation = await conversationService.createGroup(title, memberUserIds)
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
      const clientMessageId = crypto.randomUUID()
      await messageService.send(
        conversationId,
        clientMessageId,
        syntheticMessageCodec.encode(normalized),
      )
      const lastSequence = state.messages.at(-1)?.sequence ?? 0
      await loadMessages(conversationId, lastSequence)
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.sending = false
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
      while (hasMore && pages < 10) {
        const page = await syncService.list(state.syncCursor)
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
        }
        state.syncCursor = page.nextCursor
        hasMore = page.hasMore
        pages += 1
      }
      if (conversationsChanged) await reloadConversations()
      if (activeMessagesChanged && state.activeConversationId) {
        await loadMessages(state.activeConversationId, state.messages.at(-1)?.sequence ?? 0)
      }
      state.phase = 'ready'
      state.message = null
    } catch (error) {
      fail(error)
    } finally {
      polling = false
    }
  }

  return {
    state: readonly(state),
    activeConversation,
    actorUserId,
    codec: syntheticMessageCodec,
    load,
    poll,
    selectConversation,
    createDirect,
    createGroup,
    send,
  }
}
