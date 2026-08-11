import type { OpaqueMessage } from '../../domain/messaging/models'
import {
  MessageProtectionError,
  type ProtocolMessageProtection,
} from './message-protection'

export type MessageContentState = 'available' | 'deleted' | 'unavailable'

export interface TimelineMessage extends OpaqueMessage {
  contentState: MessageContentState
  displayBody: string | null
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
  message: OpaqueMessage,
  protection: ProtocolMessageProtection,
): Promise<TimelineMessage> {
  if (message.ciphertextBase64 === null) {
    return {
      ...message,
      contentState: 'deleted',
      displayBody: null,
      contentSecure: false,
    }
  }
  try {
    const content = await protection.unprotectText(message.protocolVersion, {
      conversationId: message.conversationId,
      clientMessageId: message.clientMessageId,
      ciphertextBase64: message.ciphertextBase64,
    })
    return {
      ...message,
      contentState: 'available',
      displayBody: content.plaintext,
      contentSecure: content.secure,
    }
  } catch (error) {
    return {
      ...message,
      contentState: 'unavailable',
      displayBody: unavailableLabel(error),
      contentSecure: false,
    }
  }
}
