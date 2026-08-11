import { ApplicationError } from '../../application/errors'
import type {
  DurableRealtimeEventType,
  RealtimeFrame,
} from '../../domain/messaging/realtime'

const DURABLE_TYPES = new Set<DurableRealtimeEventType>([
  'new_message',
  'conversation_updated',
  'message_deleted',
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

export function parseRealtimeFrame(value: unknown): RealtimeFrame {
  const frame = record(value)
  const type = requiredString(frame, 'type')
  if (type === 'hello' || type === 'ping') return { type }
  if (!DURABLE_TYPES.has(type as DurableRealtimeEventType)) {
    throw new ApplicationError(200, 'invalid-response', 'unknown realtime frame')
  }
  const messageId = frame.message_id
  if (messageId !== null && (typeof messageId !== 'string' || messageId.length === 0)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid realtime frame')
  }
  return {
    type: type as DurableRealtimeEventType,
    eventId: requiredString(frame, 'event_id'),
    conversationId: requiredString(frame, 'conversation_id'),
    messageId,
  }
}
