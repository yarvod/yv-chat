export type DurableRealtimeEventType =
  | 'new_message'
  | 'conversation_updated'
  | 'message_deleted'
  | 'message_reaction_updated'
  | 'message_pin_updated'
  | 'read_receipt'
  | 'delivery_receipt'

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

export type CallSignalType =
  | 'call_offer'
  | 'call_answer'
  | 'ice_candidate'
  | 'call_rejected'
  | 'call_ended'

export interface CallRealtimeFrame {
  type: CallSignalType
  version: 2
  eventId: string
  conversationId: string
  callId: string
  actorUserId: string
  actorDeviceId: string
  sdp: string | null
  candidate: string | null
  reason: string | null
  identitySignature: string | null
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
      deliverySequence: number | null
    }
  | TypingRealtimeFrame
  | PresenceRealtimeFrame
  | CallRealtimeFrame

export interface RealtimeCloseReason {
  unauthorized: boolean
}
