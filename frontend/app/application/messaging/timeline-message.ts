import type { MessageAttachment, OpaqueMessage } from '../../domain/messaging/models'
import type { VoiceCallSummary } from '../../domain/calls/voice-call'
import type { ArchivedMessage } from '../ports/message-archive'
import { decodeGroupMessageContent } from './group-message-content'
import {
  decodeDirectMessageContent,
  type DecodedDirectMessageContent,
  type DirectAttachmentSecrets,
} from './direct-message-content'
import {
  MessageProtectionError,
  type ProtocolMessageProtection,
} from './message-protection'

export type MessageContentState = 'available' | 'deleted' | 'unavailable'

export interface TimelineMessage extends OpaqueMessage {
  contentState: MessageContentState
  displayBody: string | null
  displayAttachments?: readonly MessageAttachment[]
  replyToMessageId?: string
  mentionedUserIds?: readonly string[]
  call?: VoiceCallSummary
  contentSecure: boolean
}

function unavailableLabel(error: unknown): string {
  if (error instanceof MessageProtectionError) {
    if (error.kind === 'provider-unavailable') {
      return 'Защищённое сообщение недоступно на этом устройстве.'
    }
    if (error.kind === 'unsupported-protocol') {
      return 'Эта версия защищённого сообщения не поддерживается.'
    }
  }
  return 'Сообщение повреждено или не прошло проверку.'
}

export async function prepareTimelineMessage(
  message: ArchivedMessage,
  protection: ProtocolMessageProtection,
  directSecrets?: DirectAttachmentSecrets,
): Promise<TimelineMessage> {
  const { localPlaintext: _localPlaintext, ...envelope } = message
  if (message.ciphertextBase64 === null) {
    return {
      ...envelope,
      contentState: 'deleted',
      displayBody: null,
      contentSecure: false,
    }
  }
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
      : decodeDirectMessageContent(content.plaintext, message.conversationId, directSecrets)
    const call = message.protocolVersion === 2
      ? (decoded as DecodedDirectMessageContent).call
      : undefined
    return {
      ...envelope,
      contentState: 'available',
      displayBody: decoded.text,
      ...(decoded.attachments.length > 0 ? { displayAttachments: decoded.attachments } : {}),
      ...(call ? { call } : {}),
      ...(decoded.replyToMessageId ? { replyToMessageId: decoded.replyToMessageId } : {}),
      ...((decoded.mentionedUserIds?.length ?? 0) > 0
        ? { mentionedUserIds: decoded.mentionedUserIds }
        : {}),
      contentSecure: content.secure,
    }
  } catch (error) {
    return {
      ...envelope,
      contentState: 'unavailable',
      displayBody: unavailableLabel(error),
      contentSecure: false,
    }
  }
}
