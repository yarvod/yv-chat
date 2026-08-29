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
  kind: 'speaker' | 'earpiece' | 'headphones' | 'bluetooth' | 'other'
}

export interface VoiceCallState {
  phase: VoiceCallPhase
  conversationId: string | null
  callId: string | null
  muted: boolean
  startedAt: number | null
  notice: string | null
  audioOutputSupported: boolean
  audioOutputPickerSupported: boolean
  audioOutputs: readonly VoiceCallAudioOutput[]
  selectedAudioOutputId: string
  identityVerified: boolean
  verificationCode: string | null
  cameraSupported: boolean
  cameraEnabled: boolean
  cameraBusy: boolean
  cameraFacingMode: 'user' | 'environment'
  screenShareSupported: boolean
  screenSharing: boolean
  remoteVideoEnabled: boolean
}
