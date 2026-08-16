import { ApplicationError } from '../../application/errors'
import type {
  Conversation,
  ConversationMember,
  ConversationRole,
  ConversationType,
  DeleteMessageResult,
  DirectoryUser,
  MessageHistoryPage,
  MessageReactionSummary,
  MessagePinSummary,
  OpaqueMessage,
  SendMessageReceipt,
  MessageDeletionReason,
  SyncEvent,
  SyncEventType,
  SyncPage,
} from '../../domain/messaging/models'
import { arrayField, booleanField, integerField, nullableStringField, record, stringField } from './runtime-parsers'

function enumField<T extends string>(value: Record<string, unknown>, name: string, allowed: readonly T[]): T {
  const field = stringField(value, name)
  const match = allowed.find(item => item === field)
  if (match === undefined) throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  return match
}

export function parseDirectoryUser(value: unknown): DirectoryUser {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    username: stringField(item, 'username'),
    displayName: stringField(item, 'display_name'),
  }
}

export function parseDirectory(value: unknown): DirectoryUser[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid directory')
  return value.map(parseDirectoryUser)
}

function parseConversationMember(value: unknown): ConversationMember {
  const item = record(value)
  return {
    ...parseDirectoryUser(item),
    role: enumField<ConversationRole>(item, 'role', ['member', 'admin', 'owner']),
    joinedAt: stringField(item, 'joined_at'),
    leftAt: nullableStringField(item, 'left_at'),
  }
}

export function parseConversation(value: unknown): Conversation {
  const item = record(value)
  return {
    conversationId: stringField(item, 'conversation_id'),
    conversationType: enumField<ConversationType>(item, 'conversation_type', ['direct', 'group']),
    title: nullableStringField(item, 'title'),
    createdBy: stringField(item, 'created_by'),
    createdAt: stringField(item, 'created_at'),
    updatedAt: stringField(item, 'updated_at'),
    members: arrayField(item, 'members').map(parseConversationMember),
  }
}

export function parseConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid conversations')
  return value.map(parseConversation)
}

export function parseOpaqueMessage(value: unknown): OpaqueMessage {
  const item = record(value)
  const ciphertextBase64 = nullableStringField(item, 'ciphertext_base64')
  const deletedAt = nullableStringField(item, 'deleted_at')
  const deletionReason = item.deletion_reason === null
    ? null
    : enumField<MessageDeletionReason>(item, 'deletion_reason', ['manual', 'expired'])
  if (
    (ciphertextBase64 !== null && (deletionReason !== null || deletedAt !== null))
    || (ciphertextBase64 === null && (deletionReason === null || deletedAt === null))
  ) {
    throw new ApplicationError(200, 'invalid-response', 'invalid message tombstone shape')
  }
  const protocolVersion = integerField(item, 'protocol_version')
  const crypto = parseCryptoBinding(item, protocolVersion)
  return {
    messageId: stringField(item, 'message_id'),
    clientMessageId: stringField(item, 'client_message_id'),
    conversationId: stringField(item, 'conversation_id'),
    senderUserId: stringField(item, 'sender_user_id'),
    senderDeviceId: stringField(item, 'sender_device_id'),
    protocolVersion,
    ...crypto,
    sequence: integerField(item, 'sequence'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
    ciphertextBase64,
    deletionReason,
    deletedAt,
  }
}

export function parseSendMessageReceipt(value: unknown): SendMessageReceipt {
  const item = record(value)
  const protocolVersion = integerField(item, 'protocol_version')
  return {
    messageId: stringField(item, 'message_id'),
    clientMessageId: stringField(item, 'client_message_id'),
    conversationId: stringField(item, 'conversation_id'),
    senderUserId: stringField(item, 'sender_user_id'),
    senderDeviceId: stringField(item, 'sender_device_id'),
    protocolVersion,
    ...parseCryptoBinding(item, protocolVersion),
    sequence: integerField(item, 'sequence'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

function parseCryptoBinding(
  item: Record<string, unknown>,
  protocolVersion: number,
): { cryptoGenerationId: string | null, cryptoEpoch: number | null } {
  const cryptoGenerationId = nullableStringField(item, 'crypto_generation_id')
  const rawEpoch = item.crypto_epoch
  const cryptoEpoch = rawEpoch === null ? null : Number(rawEpoch)
  if (
    (rawEpoch !== null && (!Number.isSafeInteger(rawEpoch) || Number(rawEpoch) <= 0))
    || (protocolVersion === 2) !== (cryptoGenerationId !== null && cryptoEpoch !== null)
    || (protocolVersion !== 2 && (cryptoGenerationId !== null || cryptoEpoch !== null))
  ) throw new ApplicationError(200, 'invalid-response', 'invalid message crypto binding')
  return { cryptoGenerationId, cryptoEpoch }
}

export function parseDeleteMessageResult(value: unknown): DeleteMessageResult {
  const item = record(value)
  return {
    messageId: stringField(item, 'message_id'),
    conversationId: stringField(item, 'conversation_id'),
    sequence: integerField(item, 'sequence'),
    deletionReason: enumField<MessageDeletionReason>(
      item, 'deletion_reason', ['manual', 'expired'],
    ),
    deletedAt: stringField(item, 'deleted_at'),
    advanced: booleanField(item, 'advanced'),
  }
}

export function parseMessages(value: unknown): OpaqueMessage[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid messages')
  return value.map(parseOpaqueMessage)
}

export function parseMessageHistoryPage(value: unknown): MessageHistoryPage {
  const item = record(value)
  const hasMore = booleanField(item, 'has_more')
  const oldestSequence = item.oldest_sequence === null
    ? null
    : integerField(item, 'oldest_sequence')
  const newestSequence = item.newest_sequence === null
    ? null
    : integerField(item, 'newest_sequence')
  const messages = arrayField(item, 'messages').map(parseOpaqueMessage)
  const stableAscending = messages.every((message, index) => (
    message.sequence > 0
    && (index === 0 || (messages[index - 1]?.sequence ?? 0) < message.sequence)
  ))
  if (
    !stableAscending
    || (messages.length === 0 && (oldestSequence !== null || newestSequence !== null || hasMore))
    || (messages.length > 0 && (
      oldestSequence !== messages[0]?.sequence
      || newestSequence !== messages.at(-1)?.sequence
    ))
  ) {
    throw new ApplicationError(200, 'invalid-response', 'invalid message history bounds')
  }
  return {
    messages,
    hasMore,
    oldestSequence,
    newestSequence,
  }
}

export function parseMessageReactions(value: unknown): MessageReactionSummary[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid message reactions')
  }
  return value.map(raw => {
    const item = record(raw)
    const count = integerField(item, 'count')
    const reaction = stringField(item, 'reaction')
    if (count <= 0 || reaction.length === 0 || reaction.length > 8) {
      throw new ApplicationError(200, 'invalid-response', 'invalid message reaction')
    }
    return {
      messageId: stringField(item, 'message_id'),
      reaction,
      count,
      reactedByActor: booleanField(item, 'reacted_by_actor'),
    }
  })
}

export function parseMessagePins(value: unknown): MessagePinSummary[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid message pins')
  }
  const pins = value.map(raw => {
    const item = record(raw)
    const sequence = integerField(item, 'sequence')
    const pinnedAt = stringField(item, 'pinned_at')
    if (sequence <= 0 || Number.isNaN(Date.parse(pinnedAt))) {
      throw new ApplicationError(200, 'invalid-response', 'invalid message pin')
    }
    return {
      messageId: stringField(item, 'message_id'),
      sequence,
      pinnedByUserId: stringField(item, 'pinned_by_user_id'),
      pinnedAt,
    }
  })
  if (pins.length > 50 || pins.some((pin, index) => (
    index > 0 && Date.parse(pin.pinnedAt) > Date.parse(pins[index - 1]!.pinnedAt)
  ))) {
    throw new ApplicationError(200, 'invalid-response', 'invalid message pin ordering')
  }
  return pins
}

function parseSyncEvent(value: unknown): SyncEvent {
  const item = record(value)
  const eventType = enumField<SyncEventType>(item, 'event_type', [
    'conversation_updated',
    'message_created',
    'message_deleted',
    'message_reaction_updated',
    'message_pin_updated',
    'read_receipt',
    'delivery_receipt',
  ])
  const messageId = nullableStringField(item, 'message_id')
  const actorUserId = nullableStringField(item, 'actor_user_id')
  const readSequence = item.read_sequence === null ? null : integerField(item, 'read_sequence')
  const deliverySequence = item.delivery_sequence === null
    ? null
    : integerField(item, 'delivery_sequence')
  const valid = eventType === 'conversation_updated'
    ? messageId === null && actorUserId === null && readSequence === null && deliverySequence === null
      : eventType === 'message_reaction_updated' || eventType === 'message_pin_updated'
        ? messageId !== null && actorUserId !== null && readSequence === null
          && deliverySequence === null
      : eventType === 'read_receipt'
      ? messageId === null && actorUserId !== null && readSequence !== null
        && readSequence > 0 && deliverySequence === null
      : eventType === 'delivery_receipt'
        ? messageId === null && actorUserId !== null && readSequence === null
          && deliverySequence !== null && deliverySequence > 0
        : messageId !== null && actorUserId === null && readSequence === null
          && deliverySequence === null
  if (!valid) throw new ApplicationError(200, 'invalid-response', 'invalid sync event shape')
  return {
    eventId: stringField(item, 'event_id'),
    cursor: integerField(item, 'cursor'),
    eventType,
    conversationId: stringField(item, 'conversation_id'),
    messageId,
    actorUserId,
    readSequence,
    deliverySequence,
    createdAt: stringField(item, 'created_at'),
  }
}

export function parseSyncPage(value: unknown): SyncPage {
  const item = record(value)
  return {
    events: arrayField(item, 'events').map(parseSyncEvent),
    nextCursor: integerField(item, 'next_cursor'),
    streamCursor: integerField(item, 'stream_cursor'),
    hasMore: booleanField(item, 'has_more'),
    resetRequired: booleanField(item, 'reset_required'),
  }
}
