import { ApplicationError } from '../../application/errors'
import type {
  DurableRealtimeEventType,
  RealtimeFrame,
} from '../../domain/messaging/realtime'

const DURABLE_TYPES = new Set<DurableRealtimeEventType>([
  'new_message',
  'conversation_updated',
  'message_deleted',
  'message_reaction_updated',
  'read_receipt',
  'delivery_receipt',
])

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  return value as Record<string, unknown>
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  return field
}

function requiredBoolean(value: Record<string, unknown>, key: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  return field
}

export function parseRealtimeFrame(value: unknown): RealtimeFrame {
  const frame = record(value)
  const type = requiredString(frame, 'type')
  if (type === 'hello' || type === 'ping') return { type }
  if (type === 'typing') {
    if (new Set(Object.keys(frame)).size !== 7 || ![
      'type',
      'event_id',
      'conversation_id',
      'message_id',
      'actor_user_id',
      'active',
      'expires_at',
    ].every(key => key in frame)) {
      throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
    }
    if (frame.message_id !== null || frame.read_sequence !== undefined) {
      throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
    }
    const expiresAt = requiredString(frame, 'expires_at')
    if (
      !Number.isFinite(Date.parse(expiresAt))
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)
    ) {
      throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
    }
    return {
      type,
      eventId: requiredString(frame, 'event_id'),
      conversationId: requiredString(frame, 'conversation_id'),
      actorUserId: requiredString(frame, 'actor_user_id'),
      active: requiredBoolean(frame, 'active'),
      expiresAt,
    }
  }
  if (type === 'presence') {
    if (new Set(Object.keys(frame)).size !== 6 || ![
      'type',
      'event_id',
      'conversation_id',
      'message_id',
      'actor_user_id',
      'online',
    ].every(key => key in frame) || frame.message_id !== null) {
      throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
    }
    return {
      type,
      eventId: requiredString(frame, 'event_id'),
      conversationId: requiredString(frame, 'conversation_id'),
      actorUserId: requiredString(frame, 'actor_user_id'),
      online: requiredBoolean(frame, 'online'),
    }
  }
  if (!DURABLE_TYPES.has(type as DurableRealtimeEventType)) {
    throw new ApplicationError(200, 'invalid-response', 'unknown realtime frame')
  }
  const messageId = frame.message_id
  if (messageId !== null && (typeof messageId !== 'string' || messageId.length === 0)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  const actorUserId = frame.actor_user_id === undefined || frame.actor_user_id === null
    ? null
    : requiredString(frame, 'actor_user_id')
  const rawReadSequence = frame.read_sequence
  const readSequence = rawReadSequence === undefined || rawReadSequence === null
    ? null
    : (() => {
        if (!Number.isSafeInteger(rawReadSequence) || Number(rawReadSequence) <= 0) {
          throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
        }
        return Number(rawReadSequence)
      })()
  const rawDeliverySequence = frame.delivery_sequence
  const deliverySequence = rawDeliverySequence === undefined || rawDeliverySequence === null
    ? null
    : (() => {
        if (!Number.isSafeInteger(rawDeliverySequence) || Number(rawDeliverySequence) <= 0) {
          throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
        }
        return Number(rawDeliverySequence)
      })()
  const isReadReceipt = type === 'read_receipt'
  const isDeliveryReceipt = type === 'delivery_receipt'
  const isReactionUpdate = type === 'message_reaction_updated'
  if (
    isReactionUpdate
      ? messageId === null || actorUserId === null || readSequence !== null
        || deliverySequence !== null
      : isReadReceipt
      ? messageId !== null || actorUserId === null || readSequence === null
        || deliverySequence !== null
      : isDeliveryReceipt
        ? messageId !== null || actorUserId === null || readSequence !== null
          || deliverySequence === null
        : actorUserId !== null || readSequence !== null || deliverySequence !== null
  ) {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  return {
    type: type as DurableRealtimeEventType,
    eventId: requiredString(frame, 'event_id'),
    conversationId: requiredString(frame, 'conversation_id'),
    messageId,
    actorUserId,
    readSequence,
    deliverySequence,
  }
}
