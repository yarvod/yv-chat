import {
  inject,
  ref,
  shallowRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from 'vue'

import type { ConversationAudioTrack } from '../../application/messaging/conversation-audio'
import type { MessageAttachment } from '../../domain/messaging/models'

export interface ConversationAudioPlayRequest {
  trackId: string
  nonce: number
}

export interface ConversationAudioPlayback {
  activeTrackId: string | null
  phase: 'idle' | 'loading' | 'ready' | 'error'
  playing: boolean
}

export interface ConversationAudioSource {
  conversationId: string
  conversationTitle: string
  tracks: readonly ConversationAudioTrack[]
  loadAttachment: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
}

export interface ConversationAudioPlayerController {
  readonly source: Readonly<ShallowRef<ConversationAudioSource | null>>
  readonly request: Readonly<ShallowRef<ConversationAudioPlayRequest | null>>
  readonly playback: Readonly<Ref<ConversationAudioPlayback>>
  requestTrack(source: ConversationAudioSource, trackId: string): void
  updateSource(source: ConversationAudioSource): void
  reportPlayback(playback: ConversationAudioPlayback): void
  close(): void
}

const IDLE_PLAYBACK: ConversationAudioPlayback = {
  activeTrackId: null,
  phase: 'idle',
  playing: false,
}

export const conversationAudioPlayerKey: InjectionKey<ConversationAudioPlayerController> = Symbol(
  'conversation-audio-player',
)

export function createConversationAudioPlayerController(): ConversationAudioPlayerController {
  const source = shallowRef<ConversationAudioSource | null>(null)
  const request = shallowRef<ConversationAudioPlayRequest | null>(null)
  const playback = ref<ConversationAudioPlayback>({ ...IDLE_PLAYBACK })
  let requestNonce = 0

  return {
    source,
    request,
    playback,
    requestTrack(nextSource, trackId) {
      if (source.value?.conversationId !== nextSource.conversationId) {
        playback.value = { ...IDLE_PLAYBACK }
      }
      source.value = nextSource
      request.value = { trackId, nonce: ++requestNonce }
    },
    updateSource(nextSource) {
      if (source.value?.conversationId !== nextSource.conversationId) return
      source.value = nextSource
    },
    reportPlayback(nextPlayback) {
      if (!source.value) return
      playback.value = nextPlayback
    },
    close() {
      source.value = null
      request.value = null
      playback.value = { ...IDLE_PLAYBACK }
    },
  }
}

export function useConversationAudioPlayer(): ConversationAudioPlayerController {
  const controller = inject(conversationAudioPlayerKey)
  if (!controller) throw new Error('conversation audio player is not provided')
  return controller
}
