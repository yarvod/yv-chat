import type { VoiceCallAudioOutput } from '../../domain/calls/voice-call'

export type NativeCallAudioRoute = 'system' | 'earpiece' | 'speaker'

export interface NativeCallAudioState {
  selectedRoute: NativeCallAudioRoute
  outputs: readonly VoiceCallAudioOutput[]
}

export interface NativeCallAudioPort {
  activate(video: boolean): Promise<NativeCallAudioState>
  setVideo(video: boolean): Promise<NativeCallAudioState>
  selectRoute(route: NativeCallAudioRoute): Promise<NativeCallAudioState>
  setProximity(enabled: boolean): Promise<void>
  deactivate(): Promise<void>
  subscribe(listener: (state: NativeCallAudioState) => void): Promise<() => Promise<void>>
}
