export type DurableRealtimeEventType =
  | 'new_message'
  | 'conversation_updated'
  | 'message_deleted'
  | 'read_receipt'

export interface TypingRealtimeFrame {
  type: 'typing'
  eventId: string
  conversationId: string
  actorUserId: string
  active: boolean
  expiresAt: string
}

export type RealtimeFrame =
  | { type: 'hello' }
  | { type: 'ping' }
  | {
      type: DurableRealtimeEventType
      eventId: string
      conversationId: string
      messageId: string | null
      actorUserId: string | null
      readSequence: number | null
    }
  | TypingRealtimeFrame

export interface RealtimeCloseReason {
  unauthorized: boolean
}
