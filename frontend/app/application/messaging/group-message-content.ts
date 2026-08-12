import type { MessageAttachment } from '../../domain/messaging/models'

const PREFIX = 'yv-chat/group-content/v1:'
const MAX_ATTACHMENTS = 10
const MAX_NAME_LENGTH = 180

export interface GroupMessageContent {
  text: string
  attachments: readonly MessageAttachment[]
}

function validAttachment(value: unknown): value is MessageAttachment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.attachmentId === 'string'
    && item.attachmentId.length > 0
    && item.attachmentId.length <= 64
    && (item.kind === 'image' || item.kind === 'file')
    && typeof item.name === 'string'
    && item.name.length > 0
    && item.name.length <= MAX_NAME_LENGTH
    && typeof item.contentType === 'string'
    && item.contentType.length > 2
    && item.contentType.length <= 100
    && Number.isSafeInteger(item.byteSize)
    && Number(item.byteSize) > 0
    && Number(item.byteSize) <= 25 * 1024 * 1024
}

export function encodeGroupMessageContent(content: GroupMessageContent): string {
  const text = content.text.trim()
  if (text.length > 4_000 || content.attachments.length > MAX_ATTACHMENTS) {
    throw new TypeError('invalid group message content')
  }
  if (!text && content.attachments.length === 0) {
    throw new TypeError('empty group message content')
  }
  if (!content.attachments.every(validAttachment)) {
    throw new TypeError('invalid group attachment metadata')
  }
  if (content.attachments.length === 0) return text
  return `${PREFIX}${JSON.stringify({ text, attachments: content.attachments })}`
}

export function decodeGroupMessageContent(plaintext: string): GroupMessageContent {
  if (!plaintext.startsWith(PREFIX)) return { text: plaintext, attachments: [] }
  try {
    const value: unknown = JSON.parse(plaintext.slice(PREFIX.length))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const item = value as Record<string, unknown>
    if (
      typeof item.text !== 'string'
      || item.text.length > 4_000
      || !Array.isArray(item.attachments)
      || item.attachments.length === 0
      || item.attachments.length > MAX_ATTACHMENTS
      || !item.attachments.every(validAttachment)
    ) throw new Error()
    return { text: item.text, attachments: item.attachments }
  } catch {
    return { text: plaintext, attachments: [] }
  }
}

export function attachmentDownloadUrl(conversationId: string, attachmentId: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}`
    + `/attachments/${encodeURIComponent(attachmentId)}`
}
