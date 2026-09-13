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

export const SCREEN_SHARE_RESOLUTIONS = [720, 1080, 1440] as const
export const SCREEN_SHARE_FRAME_RATES = [15, 30, 60] as const

export interface ScreenShareQuality {
  readonly resolution: typeof SCREEN_SHARE_RESOLUTIONS[number]
  readonly frameRate: typeof SCREEN_SHARE_FRAME_RATES[number]
}

export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQuality = {
  resolution: 1080,
  frameRate: 15,
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
  screenShareQuality: ScreenShareQuality
  remoteVideoEnabled: boolean
}
