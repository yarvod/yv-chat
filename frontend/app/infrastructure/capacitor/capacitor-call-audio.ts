import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import type {
  NativeCallAudioPort,
  NativeCallAudioRoute,
  NativeCallAudioState,
} from '../../application/ports/native-call-audio'
import type { VoiceCallAudioOutput } from '../../domain/calls/voice-call'

interface NativeRouteState {
  selectedRoute?: unknown
  earpieceAvailable?: unknown
}

export interface CallAudioPlugin {
  activate(options: { video: boolean }): Promise<NativeRouteState>
  setVideo(options: { video: boolean }): Promise<NativeRouteState>
  setRoute(options: { route: NativeCallAudioRoute }): Promise<NativeRouteState>
  setProximity(options: { enabled: boolean }): Promise<void>
  deactivate(): Promise<void>
  addListener(
    eventName: 'routeChanged',
    listener: (state: NativeRouteState) => void,
  ): Promise<PluginListenerHandle>
}

const nativePlugin = registerPlugin<CallAudioPlugin>('CallAudio')

const SPEAKER: VoiceCallAudioOutput = {
  deviceId: 'native:speaker',
  label: 'Встроенный динамик',
  kind: 'speaker',
}
const EARPIECE: VoiceCallAudioOutput = {
  deviceId: 'native:earpiece',
  label: 'Разговорный динамик',
  kind: 'earpiece',
}

function parseState(value: NativeRouteState): NativeCallAudioState {
  const selectedRoute = value.selectedRoute === 'speaker'
    ? 'speaker'
    : value.selectedRoute === 'earpiece'
      ? 'earpiece'
      : 'system'
  return {
    selectedRoute,
    outputs: value.earpieceAvailable === false ? [SPEAKER] : [EARPIECE, SPEAKER],
  }
}

export class CapacitorCallAudio implements NativeCallAudioPort {
  constructor(private readonly plugin: CallAudioPlugin = nativePlugin) {}

  async activate(video: boolean): Promise<NativeCallAudioState> {
    return parseState(await this.plugin.activate({ video }))
  }

  async setVideo(video: boolean): Promise<NativeCallAudioState> {
    return parseState(await this.plugin.setVideo({ video }))
  }

  async selectRoute(route: NativeCallAudioRoute): Promise<NativeCallAudioState> {
    return parseState(await this.plugin.setRoute({ route }))
  }

  async setProximity(enabled: boolean): Promise<void> {
    await this.plugin.setProximity({ enabled })
  }

  async deactivate(): Promise<void> {
    await this.plugin.deactivate()
  }

  async subscribe(listener: (state: NativeCallAudioState) => void): Promise<() => Promise<void>> {
    const handle = await this.plugin.addListener('routeChanged', state => listener(parseState(state)))
    return async () => handle.remove()
  }
}
