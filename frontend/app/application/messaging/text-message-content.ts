const PREFIX = 'yv-chat/text-content/v1:'
const MAX_TEXT_LENGTH = 4_000
const MAX_MENTIONS = 50
const MAX_ID_LENGTH = 64

export interface MessageInteractionContent {
  text: string
  replyToMessageId: string | null
  mentionedUserIds: readonly string[]
}

export interface MessageInteractionContext {
  replyToMessageId?: string | null
  mentionedUserIds?: readonly string[]
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && !/\s/.test(value)
}

function normalizedMentions(values: readonly string[]): string[] {
  const unique = [...new Set(values)]
  if (unique.length > MAX_MENTIONS || !unique.every(validId)) {
    throw new TypeError('invalid message mentions')
  }
  return unique
}

export function encodeTextMessageContent(content: MessageInteractionContent): string {
  const text = content.text.trim()
  const mentionedUserIds = normalizedMentions(content.mentionedUserIds)
  if (!text || text.length > MAX_TEXT_LENGTH) throw new TypeError('invalid message text')
  if (content.replyToMessageId !== null && !validId(content.replyToMessageId)) {
    throw new TypeError('invalid reply target')
  }
  if (content.replyToMessageId === null && mentionedUserIds.length === 0) return text
  return `${PREFIX}${JSON.stringify({
    text,
    reply_to_message_id: content.replyToMessageId,
    mentioned_user_ids: mentionedUserIds,
  })}`
}

export function decodeTextMessageContent(plaintext: string): MessageInteractionContent {
  const legacy = { text: plaintext, replyToMessageId: null, mentionedUserIds: [] }
  if (!plaintext.startsWith(PREFIX)) return legacy
  try {
    const value: unknown = JSON.parse(plaintext.slice(PREFIX.length))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    const item = value as Record<string, unknown>
    if (
      typeof item.text !== 'string'
      || item.text.length === 0
      || item.text.length > MAX_TEXT_LENGTH
      || (item.reply_to_message_id !== null && !validId(item.reply_to_message_id))
      || !Array.isArray(item.mentioned_user_ids)
      || item.mentioned_user_ids.length > MAX_MENTIONS
      || !item.mentioned_user_ids.every(validId)
      || new Set(item.mentioned_user_ids).size !== item.mentioned_user_ids.length
    ) throw new Error()
    return {
      text: item.text,
      replyToMessageId: item.reply_to_message_id as string | null,
      mentionedUserIds: item.mentioned_user_ids,
    }
  } catch {
    return legacy
  }
}
