import type { ConversationType } from '../../domain/messaging/models'

export type OutgoingMessageProtocolVersion = 1 | 2

export function outgoingProtocolVersion(
  conversationType: ConversationType,
): OutgoingMessageProtocolVersion {
  return conversationType === 'direct' ? 2 : 1
}

export function conversationUsesEndToEndEncryption(
  conversationType: ConversationType,
): boolean {
  return conversationType === 'direct'
}

export function conversationProtectionLabel(conversationType: ConversationType): string {
  return conversationType === 'direct'
    ? 'MLS E2EE'
    : 'Групповой чат без E2EE: сообщения доступны серверу'
}
