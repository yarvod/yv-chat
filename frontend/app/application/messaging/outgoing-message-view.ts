import type { OutboxFailureCode, OutboxMessage, OutboxMessageStatus } from '../../domain/messaging/outbox'
import type { ProtocolMessageProtection } from './message-protection'
import type { MessageAttachment } from '../../domain/messaging/models'
import { decodeGroupMessageContent } from './group-message-content'

export interface OutgoingMessageView {
  clientMessageId: string
  conversationId: string
  createdAt: string
  displayBody: string
  displayAttachments?: readonly MessageAttachment[]
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
    const content = message.localPlaintext
      ? { plaintext: message.localPlaintext, secure: message.protocolVersion === 2 }
      : await protection.unprotectText(message.protocolVersion, {
          conversationId: message.conversationId,
          clientMessageId: message.clientMessageId,
          ciphertextBase64: message.ciphertextBase64,
        })
    const decoded = message.protocolVersion === 1
      ? decodeGroupMessageContent(content.plaintext)
      : { text: content.plaintext, attachments: [] }
    return {
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      displayBody: decoded.text,
      ...(decoded.attachments.length > 0 ? { displayAttachments: decoded.attachments } : {}),
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
