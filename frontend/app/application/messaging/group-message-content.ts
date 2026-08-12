import type { MessageAttachment } from '../../domain/messaging/models'
import { maximumAttachmentBytes } from './group-attachment-policy'

const PREFIX = 'yv-chat/group-content/v1:'
const MAX_ATTACHMENTS = 10
const MAX_NAME_LENGTH = 180

export interface GroupMessageContent {
  text: string
  attachments: readonly MessageAttachment[]
  replyToMessageId?: string | null
  mentionedUserIds?: readonly string[]
}

function validInteractionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/\s/.test(value)
}

function validAttachment(value: unknown): value is MessageAttachment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const baseValid = typeof item.attachmentId === 'string'
    && item.attachmentId.length > 0
    && item.attachmentId.length <= 64
    && (item.kind === 'image' || item.kind === 'video' || item.kind === 'file')
    && typeof item.name === 'string'
    && item.name.length > 0
    && item.name.length <= MAX_NAME_LENGTH
    && typeof item.contentType === 'string'
    && item.contentType.length > 2
    && item.contentType.length <= 100
    && Number.isSafeInteger(item.byteSize)
    && Number(item.byteSize) > 0
    && Number(item.byteSize) <= maximumAttachmentBytes(item.kind)
  if (!baseValid) return false
  if (item.presentation === undefined && item.durationSeconds === undefined) return true
  return item.presentation === 'video_note'
    && item.kind === 'video'
    && Number.isInteger(item.durationSeconds)
    && Number(item.durationSeconds) >= 1
    && Number(item.durationSeconds) <= 60
}

export function encodeGroupMessageContent(content: GroupMessageContent): string {
  const text = content.text.trim()
  const replyToMessageId = content.replyToMessageId ?? null
  const mentionedUserIds = [...new Set(content.mentionedUserIds ?? [])]
  if (
    text.length > 4_000
    || content.attachments.length > MAX_ATTACHMENTS
    || (replyToMessageId !== null && !validInteractionId(replyToMessageId))
    || mentionedUserIds.length > 50
    || !mentionedUserIds.every(validInteractionId)
  ) {
    throw new TypeError('invalid group message content')
  }
  if (!text && content.attachments.length === 0) {
    throw new TypeError('empty group message content')
  }
  if (!content.attachments.every(validAttachment)) {
    throw new TypeError('invalid group attachment metadata')
  }
  if (content.attachments.length === 0 && replyToMessageId === null && mentionedUserIds.length === 0) {
    return text
  }
  return `${PREFIX}${JSON.stringify({
    text,
    attachments: content.attachments,
    reply_to_message_id: replyToMessageId,
    mentioned_user_ids: mentionedUserIds,
  })}`
}

export function decodeGroupMessageContent(plaintext: string): GroupMessageContent {
  const legacy = { text: plaintext, attachments: [] }
  if (!plaintext.startsWith(PREFIX)) return legacy
  try {
    const value: unknown = JSON.parse(plaintext.slice(PREFIX.length))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const item = value as Record<string, unknown>
    if (
      typeof item.text !== 'string'
      || item.text.length > 4_000
      || !Array.isArray(item.attachments)
      || item.attachments.length > MAX_ATTACHMENTS
      || !item.attachments.every(validAttachment)
      || (item.reply_to_message_id !== undefined
        && item.reply_to_message_id !== null
        && !validInteractionId(item.reply_to_message_id))
      || (item.mentioned_user_ids !== undefined
        && (!Array.isArray(item.mentioned_user_ids)
          || item.mentioned_user_ids.length > 50
          || !item.mentioned_user_ids.every(validInteractionId)
          || new Set(item.mentioned_user_ids).size !== item.mentioned_user_ids.length))
      || (item.text.length === 0 && item.attachments.length === 0)
    ) throw new Error()
    const replyToMessageId = (item.reply_to_message_id as string | null | undefined) ?? null
    const mentionedUserIds = (item.mentioned_user_ids as string[] | undefined) ?? []
    return {
      text: item.text,
      attachments: item.attachments,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
    }
  } catch {
    return legacy
  }
}
