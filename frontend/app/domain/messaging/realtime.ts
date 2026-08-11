export type DurableRealtimeEventType =
  | 'new_message'
  | 'conversation_updated'
  | 'message_deleted'

export type RealtimeFrame =
  | { type: 'hello' }
  | { type: 'ping' }
  | {
      type: DurableRealtimeEventType
      eventId: string
      conversationId: string
      messageId: string | null
    }

export interface RealtimeCloseReason {
  unauthorized: boolean
}
