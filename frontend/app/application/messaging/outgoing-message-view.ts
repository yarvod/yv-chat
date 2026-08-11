import type { OutboxFailureCode, OutboxMessage, OutboxMessageStatus } from '../../domain/messaging/outbox'
import type { ProtocolMessageProtection } from './message-protection'

export interface OutgoingMessageView {
  clientMessageId: string
  conversationId: string
  createdAt: string
  displayBody: string
  contentSecure: boolean
  status: OutboxMessageStatus
  attemptCount: number
  failureCode: OutboxFailureCode | null
}

export async function prepareOutgoingMessageView(
  message: OutboxMessage,
  protection: ProtocolMessageProtection,
): Promise<OutgoingMessageView> {
  try {
    const content = await protection.unprotectText(message.protocolVersion, {
      conversationId: message.conversationId,
      clientMessageId: message.clientMessageId,
      ciphertextBase64: message.ciphertextBase64,
    })
    return {
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      displayBody: content.plaintext,
      contentSecure: content.secure,
      status: message.status,
      attemptCount: message.attemptCount,
      failureCode: message.failureCode,
    }
  } catch {
    return {
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      displayBody: 'Локальное сообщение повреждено или недоступно.',
      contentSecure: false,
      status: 'failed',
      attemptCount: message.attemptCount,
      failureCode: 'rejected',
    }
  }
}
