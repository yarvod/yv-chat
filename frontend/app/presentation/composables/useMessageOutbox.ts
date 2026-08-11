import { reactive, readonly } from 'vue'

import type { AcknowledgeOutboxMessage } from '../../application/messaging/acknowledge-outbox-message'
import type { DeliverOutboxMessage } from '../../application/messaging/deliver-outbox-message'
import type { ListOutboxMessages } from '../../application/messaging/list-outbox-messages'
import {
  prepareOutgoingMessageView,
  type OutgoingMessageView,
} from '../../application/messaging/outgoing-message-view'
import type { ProtocolMessageProtection } from '../../application/messaging/message-protection'
import type { QueueOutgoingMessage } from '../../application/messaging/queue-outgoing-message'
import type { RetryOutboxMessage } from '../../application/messaging/retry-outbox-message'
import type { HapticsPort } from '../../application/ports/haptics'
import { MessageOutboxError } from '../../application/ports/message-outbox'
import type { SendMessageReceipt } from '../../domain/messaging/models'
import type { OutboxMessage } from '../../domain/messaging/outbox'

export interface MessageOutboxDependencies {
  messageProtection: ProtocolMessageProtection
  haptics: HapticsPort
  listOutboxMessages: ListOutboxMessages
  queueOutgoingMessage: QueueOutgoingMessage
  deliverOutboxMessage: DeliverOutboxMessage
  acknowledgeOutboxMessage: AcknowledgeOutboxMessage
  retryOutboxMessage: RetryOutboxMessage
}

export interface MessageOutboxCallbacks {
  reconcile(message: OutboxMessage, receipt: SendMessageReceipt): Promise<void>
  unauthorized(): void
  failed(error: unknown): void
}

interface MessageOutboxState {
  status: 'ready' | 'unavailable'
  messages: OutgoingMessageView[]
  sending: boolean
  notice: string | null
}

export function useMessageOutbox(
  ownerUserId: string,
  senderDeviceId: string,
  dependencies: MessageOutboxDependencies,
  callbacks: MessageOutboxCallbacks,
) {
  const {
    messageProtection,
    haptics,
    listOutboxMessages,
    queueOutgoingMessage,
    deliverOutboxMessage,
    acknowledgeOutboxMessage,
    retryOutboxMessage,
  } = dependencies
  const state = reactive<MessageOutboxState>({
    status: 'ready',
    messages: [],
    sending: false,
    notice: null,
  })
  let flushing = false
  let flushQueued = false

  async function replaceView(message: OutboxMessage): Promise<void> {
    const view = await prepareOutgoingMessageView(message, messageProtection)
    state.messages = [
      ...state.messages.filter(item => item.clientMessageId !== view.clientMessageId),
      view,
    ].sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt)
      || left.clientMessageId.localeCompare(right.clientMessageId)
    ))
  }

  function removeView(clientMessageId: string): void {
    state.messages = state.messages.filter(item => item.clientMessageId !== clientMessageId)
  }

  async function load(): Promise<void> {
    try {
      const messages = await listOutboxMessages.execute(ownerUserId, senderDeviceId)
      state.messages = await Promise.all(messages.map(
        message => prepareOutgoingMessageView(message, messageProtection),
      ))
      state.status = 'ready'
      state.notice = null
    } catch {
      state.status = 'unavailable'
      state.messages = []
    }
  }

  async function enqueue(conversationId: string, plaintext: string): Promise<boolean> {
    state.sending = true
    state.notice = null
    try {
      const message = await queueOutgoingMessage.execute({
        ownerUserId,
        senderDeviceId,
        conversationId,
        plaintext,
      })
      await replaceView(message)
      void flush().catch(callbacks.failed)
      return true
    } catch (error) {
      if (!(error instanceof MessageOutboxError)) throw error
      if (error.kind !== 'queue-full') state.status = 'unavailable'
      state.notice = error.kind === 'queue-full'
        ? 'Локальная очередь заполнена. Повторите после доставки ожидающих сообщений.'
        : 'Не удалось надёжно сохранить сообщение. Черновик оставлен в поле ввода.'
      return false
    } finally {
      state.sending = false
    }
  }

  async function retry(clientMessageId: string): Promise<boolean> {
    try {
      const message = await retryOutboxMessage.execute(
        ownerUserId,
        senderDeviceId,
        clientMessageId,
      )
      if (!message) return false
      await replaceView(message)
      state.notice = null
      void flush().catch(callbacks.failed)
      return true
    } catch (error) {
      if (!(error instanceof MessageOutboxError)) throw error
      state.status = 'unavailable'
      state.notice = 'Локальная очередь отправки недоступна.'
      return false
    }
  }

  async function flush(): Promise<void> {
    if (flushing) {
      flushQueued = true
      return
    }
    flushing = true
    try {
      do {
        flushQueued = false
        const messages = await listOutboxMessages.execute(ownerUserId, senderDeviceId)
        state.status = 'ready'
        state.notice = null
        const blockedConversations = new Set<string>()
        for (const message of messages) {
          if (blockedConversations.has(message.conversationId)) continue
          if (message.status === 'failed') continue
          const result = await deliverOutboxMessage.execute(message)
          await replaceView(result.message)
          if (result.kind === 'deferred' || result.kind === 'retryable') {
            blockedConversations.add(message.conversationId)
            continue
          }
          if (result.kind === 'failed') {
            if (result.message.failureCode === 'unauthorized') callbacks.unauthorized()
            continue
          }
          await callbacks.reconcile(result.message, result.receipt)
          await acknowledgeOutboxMessage.execute(
            ownerUserId,
            senderDeviceId,
            result.message.clientMessageId,
          )
          removeView(result.message.clientMessageId)
          haptics.perform('sent')
        }
      } while (flushQueued)
    } catch (error) {
      if (!(error instanceof MessageOutboxError)) throw error
      state.status = 'unavailable'
      state.notice = 'Локальная очередь отправки недоступна. Сообщение не отправлено.'
    } finally {
      flushing = false
    }
  }

  return {
    state: readonly(state),
    load,
    enqueue,
    retry,
    flush,
  }
}
