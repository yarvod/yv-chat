import type { ConversationReadState } from '../../domain/messaging/models'
import type { MarkConversationReadResult } from '../../application/ports/conversation-read-state-gateway'
import { ApplicationError } from '../../application/errors'
import { booleanField, integerField, record, stringField } from './runtime-parsers'

function nonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const parsed = integerField(value, key)
  if (parsed < 0) throw new ApplicationError(200, 'invalid-response', `invalid ${key}`)
  return parsed
}

export function parseConversationReadState(value: unknown): ConversationReadState {
  const item = record(value)
  return {
    conversationId: stringField(item, 'conversation_id'),
    lastReadSequence: nonNegativeInteger(item, 'last_read_sequence'),
    latestSequence: nonNegativeInteger(item, 'latest_sequence'),
    unreadCount: nonNegativeInteger(item, 'unread_count'),
  }
}

export function parseConversationReadStates(value: unknown): ConversationReadState[] {
  if (!Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid conversation read states')
  }
  return value.map(parseConversationReadState)
}

export function parseMarkConversationReadResult(value: unknown): MarkConversationReadResult {
  const item = record(value)
  return {
    conversationId: stringField(item, 'conversation_id'),
    lastReadSequence: nonNegativeInteger(item, 'last_read_sequence'),
    updatedAt: stringField(item, 'updated_at'),
    advanced: booleanField(item, 'advanced'),
  }
}
