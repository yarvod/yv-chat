import type { ConversationMediaItem } from './conversation-media'
import type { Conversation, MessageAttachment } from '../../domain/messaging/models'

const AUDIO_FILE_EXTENSIONS = new Set([
  'aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba',
])

export interface ConversationAudioTrack extends ConversationMediaItem {
  trackId: string
  title: string
  senderName: string
}

function fileExtension(name: string): string {
  const separator = name.lastIndexOf('.')
  return separator < 0 ? '' : name.slice(separator + 1).trim().toLowerCase()
}

export function isAudioAttachment(attachment: MessageAttachment): boolean {
  if (attachment.kind !== 'file') return false
  const contentType = attachment.contentType.trim().toLowerCase().split(';', 1)[0] ?? ''
  return contentType.startsWith('audio/')
    || contentType === 'application/ogg'
    || AUDIO_FILE_EXTENSIONS.has(fileExtension(attachment.name))
}

export function audioTrackTitle(name: string): string {
  const normalized = name.trim() || 'Аудиофайл'
  const extension = fileExtension(normalized)
  if (!extension) return normalized
  const title = normalized.slice(0, -(extension.length + 1)).trim()
  return title || normalized
}

export function conversationAudioTracks(
  items: readonly ConversationMediaItem[],
  conversation: Conversation,
): ConversationAudioTrack[] {
  const memberNames = new Map(conversation.members.map(member => [
    member.userId,
    member.displayName,
  ]))
  return items
    .filter(item => isAudioAttachment(item.attachment))
    .map(item => ({
      ...item,
      trackId: `${item.messageId}:${item.attachment.attachmentId}`,
      title: audioTrackTitle(item.attachment.name),
      senderName: memberNames.get(item.senderUserId) ?? 'Участник',
    }))
    .sort((left, right) => left.sequence - right.sequence)
}
