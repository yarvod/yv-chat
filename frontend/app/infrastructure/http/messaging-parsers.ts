import { ApplicationError } from '../../application/errors'
import type {
  Conversation,
  ConversationMember,
  ConversationRole,
  ConversationType,
  DirectoryUser,
  OpaqueMessage,
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
  return {
    messageId: stringField(item, 'message_id'),
    clientMessageId: stringField(item, 'client_message_id'),
    conversationId: stringField(item, 'conversation_id'),
    senderUserId: stringField(item, 'sender_user_id'),
    senderDeviceId: stringField(item, 'sender_device_id'),
    protocolVersion: integerField(item, 'protocol_version'),
    sequence: integerField(item, 'sequence'),
    createdAt: stringField(item, 'created_at'),
    ciphertextBase64: stringField(item, 'ciphertext_base64'),
  }
}

export function parseMessages(value: unknown): OpaqueMessage[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid messages')
  return value.map(parseOpaqueMessage)
}

function parseSyncEvent(value: unknown): SyncEvent {
  const item = record(value)
  const eventType = enumField<SyncEventType>(item, 'event_type', [
    'conversation_updated',
    'message_created',
    'message_deleted',
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
