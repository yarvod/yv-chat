export type DurableRealtimeEventType =
  | 'new_message'
  | 'conversation_updated'
  | 'message_deleted'
  | 'read_receipt'

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

export interface RealtimeCloseReason {
  unauthorized: boolean
}
