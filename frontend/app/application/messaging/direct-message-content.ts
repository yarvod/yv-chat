import type { MessageAttachment } from '../../domain/messaging/models'

import { maximumAttachmentBytes } from './group-attachment-policy'
import { decodeTextMessageContent } from './text-message-content'

const PREFIX = 'yv-chat/direct-content/v1:'
const MAX_ATTACHMENTS = 10
const MAX_NAME_LENGTH = 180
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface DirectAttachmentSecret {
  clientAttachmentId: string
  keyBase64: string
  nonceBase64: string
  ciphertextByteSize: number
}

export interface DirectMessageAttachment {
  attachment: MessageAttachment
  secret: DirectAttachmentSecret
}

export interface DirectMessageContent {
  text: string
  attachments: readonly DirectMessageAttachment[]
  replyToMessageId?: string | null
  mentionedUserIds?: readonly string[]
}

export interface DecodedDirectMessageContent {
  text: string
  attachments: readonly MessageAttachment[]
  replyToMessageId?: string | null
  mentionedUserIds?: readonly string[]
}

export class DirectAttachmentSecrets {
  private readonly values = new Map<string, DirectAttachmentSecret>()

  register(
    conversationId: string,
    attachmentId: string,
    secret: DirectAttachmentSecret,
  ): void {
    if (!conversationId || !attachmentId || !validSecret(secret)) {
      throw new TypeError('invalid direct attachment secret scope')
    }
    this.values.set(`${conversationId}:${attachmentId}`, { ...secret })
  }

  get(conversationId: string, attachmentId: string): DirectAttachmentSecret | null {
    const secret = this.values.get(`${conversationId}:${attachmentId}`)
    return secret ? { ...secret } : null
  }

  clear(): void {
    this.values.clear()
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/\s/.test(value)
}

function validBase64(value: unknown, byteLength: number): value is string {
  if (typeof value !== 'string' || !CANONICAL_BASE64.test(value)) return false
  try {
    const decoded = atob(value)
    return decoded.length === byteLength && btoa(decoded) === value
  } catch {
    return false
  }
}

function validAttachment(value: unknown): value is MessageAttachment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const baseValid = validId(item.attachmentId)
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

function validSecret(value: unknown): value is DirectAttachmentSecret {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return validId(item.clientAttachmentId)
    && validBase64(item.keyBase64, 32)
    && validBase64(item.nonceBase64, 12)
    && Number.isSafeInteger(item.ciphertextByteSize)
    && Number(item.ciphertextByteSize) > 16
    && Number(item.ciphertextByteSize) <= 25 * 1024 * 1024
}

function validInteractionId(value: unknown): value is string {
  return validId(value)
}

export function encodeDirectMessageContent(content: DirectMessageContent): string {
  const text = content.text.trim()
  const replyToMessageId = content.replyToMessageId ?? null
  const mentionedUserIds = [...new Set(content.mentionedUserIds ?? [])]
  if (
    text.length > 4_000
    || content.attachments.length > MAX_ATTACHMENTS
    || (replyToMessageId !== null && !validInteractionId(replyToMessageId))
    || mentionedUserIds.length > 50
    || !mentionedUserIds.every(validInteractionId)
    || (!text && content.attachments.length === 0)
    || !content.attachments.every(item => (
      validAttachment(item.attachment) && validSecret(item.secret)
    ))
  ) throw new TypeError('invalid direct message content')
  if (content.attachments.length === 0 && replyToMessageId === null && mentionedUserIds.length === 0) {
    return text
  }
  return `${PREFIX}${JSON.stringify({
    text,
    attachments: content.attachments.map(item => ({
      attachment_id: item.attachment.attachmentId,
      kind: item.attachment.kind,
      name: item.attachment.name,
      content_type: item.attachment.contentType,
      byte_size: item.attachment.byteSize,
      presentation: item.attachment.presentation ?? null,
      duration_seconds: item.attachment.durationSeconds ?? null,
      client_attachment_id: item.secret.clientAttachmentId,
      key_base64: item.secret.keyBase64,
      nonce_base64: item.secret.nonceBase64,
      ciphertext_byte_size: item.secret.ciphertextByteSize,
    })),
    reply_to_message_id: replyToMessageId,
    mentioned_user_ids: mentionedUserIds,
  })}`
}

export function decodeDirectMessageContent(
  plaintext: string,
  conversationId: string,
  secrets?: DirectAttachmentSecrets,
): DecodedDirectMessageContent {
  const legacy = { ...decodeTextMessageContent(plaintext), attachments: [] }
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
      || (item.reply_to_message_id !== null && !validInteractionId(item.reply_to_message_id))
      || !Array.isArray(item.mentioned_user_ids)
      || item.mentioned_user_ids.length > 50
      || !item.mentioned_user_ids.every(validInteractionId)
      || new Set(item.mentioned_user_ids).size !== item.mentioned_user_ids.length
      || (item.text.length === 0 && item.attachments.length === 0)
    ) throw new Error()
    const attachments = item.attachments.map(value => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
      const raw = value as Record<string, unknown>
      const attachment: MessageAttachment = {
        attachmentId: String(raw.attachment_id),
        kind: raw.kind as MessageAttachment['kind'],
        name: String(raw.name),
        contentType: String(raw.content_type),
        byteSize: Number(raw.byte_size),
        ...(raw.presentation === 'video_note' ? { presentation: 'video_note' as const } : {}),
        ...(raw.duration_seconds !== null
          ? { durationSeconds: Number(raw.duration_seconds) }
          : {}),
      }
      const secret: DirectAttachmentSecret = {
        clientAttachmentId: String(raw.client_attachment_id),
        keyBase64: String(raw.key_base64),
        nonceBase64: String(raw.nonce_base64),
        ciphertextByteSize: Number(raw.ciphertext_byte_size),
      }
      if (!validAttachment(attachment) || !validSecret(secret)) throw new Error()
      secrets?.register(conversationId, attachment.attachmentId, secret)
      return attachment
    })
    return {
      text: item.text,
      attachments,
      ...(item.reply_to_message_id ? { replyToMessageId: String(item.reply_to_message_id) } : {}),
      ...(item.mentioned_user_ids.length > 0
        ? { mentionedUserIds: item.mentioned_user_ids as string[] }
        : {}),
    }
  } catch {
    throw new TypeError('invalid direct message content')
  }
}
