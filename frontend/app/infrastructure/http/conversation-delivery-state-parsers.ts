import type { ParticipantDeliveryState } from '../../domain/messaging/models'
import type { MarkConversationDeliveredResult } from '../../application/ports/conversation-delivery-state-gateway'
import { ApplicationError } from '../../application/errors'
import { booleanField, integerField, record, stringField } from './runtime-parsers'

function positiveInteger(value: Record<string, unknown>, key: string): number {
  const parsed = integerField(value, key)
  if (parsed <= 0) throw new ApplicationError(200, 'invalid-response', `invalid ${key}`)
  return parsed
}

function nonnegativeInteger(value: Record<string, unknown>, key: string): number {
  const parsed = integerField(value, key)
  if (parsed < 0) throw new ApplicationError(200, 'invalid-response', `invalid ${key}`)
  return parsed
}

export function parseParticipantDeliveryState(value: unknown): ParticipantDeliveryState {
  const item = record(value)
  return {
    conversationId: stringField(item, 'conversation_id'),
    userId: stringField(item, 'user_id'),
    deliveredSequence: positiveInteger(item, 'delivered_sequence'),
    readSequence: item.read_sequence === undefined ? 0 : nonnegativeInteger(item, 'read_sequence'),
  }
}

export function parseParticipantDeliveryStates(value: unknown): ParticipantDeliveryState[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid delivery states')
  }
  return value.map(parseParticipantDeliveryState)
}

export function parseMarkConversationDeliveredResult(
  value: unknown,
): MarkConversationDeliveredResult {
  const item = record(value)
  return {
    conversationId: stringField(item, 'conversation_id'),
    lastDeliveredSequence: positiveInteger(item, 'last_delivered_sequence'),
    updatedAt: stringField(item, 'updated_at'),
    advanced: booleanField(item, 'advanced'),
  }
}
