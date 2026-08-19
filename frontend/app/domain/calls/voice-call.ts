export type VoiceCallPhase =
  | 'idle'
  | 'incoming'
  | 'outgoing'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'error'

export interface VoiceCallState {
  phase: VoiceCallPhase
  conversationId: string | null
  callId: string | null
  muted: boolean
  startedAt: number | null
  notice: string | null
}
