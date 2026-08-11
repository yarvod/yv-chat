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

export interface PresenceRealtimeFrame {
  type: 'presence'
  eventId: string
  conversationId: string
  actorUserId: string
  online: boolean
}

export type EphemeralRealtimeFrame = TypingRealtimeFrame | PresenceRealtimeFrame

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
  | PresenceRealtimeFrame

export interface RealtimeCloseReason {
  unauthorized: boolean
}
