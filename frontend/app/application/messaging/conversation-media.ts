import type { MessageAttachment } from '../../domain/messaging/models'
import type { TimelineMessage } from './timeline-message'

export interface ConversationMediaItem {
  messageId: string
  sequence: number
  senderUserId: string
  createdAt: string
  expiresAt: string
  attachment: MessageAttachment
}

export interface ConversationMediaIndex {
  items: readonly ConversationMediaItem[]
  truncated: boolean
}

export function conversationMediaItems(
  messages: readonly TimelineMessage[],
): ConversationMediaItem[] {
  return messages
    .filter(message => message.contentState === 'available')
    .flatMap(message => (message.displayAttachments ?? []).map(attachment => ({
      messageId: message.messageId,
      sequence: message.sequence,
      senderUserId: message.senderUserId,
      createdAt: message.createdAt,
      expiresAt: message.expiresAt,
      attachment,
    })))
    .sort((left, right) => right.sequence - left.sequence)
}
