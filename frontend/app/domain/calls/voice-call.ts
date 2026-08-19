export type VoiceCallPhase =
  | 'idle'
  | 'incoming'
  | 'outgoing'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'error'

export type VoiceCallOutcome =
  | 'completed'
  | 'missed'
  | 'declined'
  | 'busy'
  | 'cancelled'
  | 'failed'

export interface VoiceCallSummary {
  callId: string
  outcome: VoiceCallOutcome
  durationSeconds: number
}

export interface VoiceCallAudioOutput {
  deviceId: string
  label: string
}

export interface VoiceCallState {
  phase: VoiceCallPhase
  conversationId: string | null
  callId: string | null
  muted: boolean
  startedAt: number | null
  notice: string | null
  audioOutputSupported: boolean
  audioOutputs: readonly VoiceCallAudioOutput[]
  selectedAudioOutputId: string
}
