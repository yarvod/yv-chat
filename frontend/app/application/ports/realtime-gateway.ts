import type {
  CallSignalType,
  RealtimeCloseReason,
  RealtimeFrame,
} from '../../domain/messaging/realtime'

export interface OutgoingCallSignal {
  type: CallSignalType
  version: 2
  conversation_id: string
  call_id: string
  sdp?: string
  candidate?: string
  reason?: string
  identity_signature?: string
}

export interface RealtimeConnection {
  close(): void
  setTyping(conversationId: string, active: boolean): void
  sendCall(signal: OutgoingCallSignal): boolean
}

export interface RealtimeCallbacks {
  onFrame(frame: RealtimeFrame): void
  onOpen(): void
  onClose(reason: RealtimeCloseReason): void
}

export interface RealtimeGateway {
  connect(callbacks: RealtimeCallbacks): RealtimeConnection
}
