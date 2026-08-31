import { describe, expect, it, vi } from 'vitest'

import type { ConversationAudioTrack } from '../app/application/messaging/conversation-audio'
import { createConversationAudioPlayerController } from '../app/presentation/composables/useConversationAudioPlayer'

const track: ConversationAudioTrack = {
  trackId: 'message-1:audio-1',
  messageId: 'message-1',
  sequence: 1,
  senderUserId: 'user-1',
  senderName: 'Ярик',
  title: 'Композиция',
  createdAt: '2026-09-01T00:00:00Z',
  expiresAt: '2026-10-01T00:00:00Z',
  attachment: {
    attachmentId: 'audio-1',
    kind: 'file',
    name: 'Композиция.mp3',
    contentType: 'audio/mpeg',
    byteSize: 128,
  },
}

describe('conversation audio player controller', () => {
  it('keeps source and playback while route content changes until explicit close', () => {
    const controller = createConversationAudioPlayerController()
    const loadAttachment = vi.fn()
    const source = {
      conversationId: 'conversation-1',
      conversationTitle: 'Музыкальный чат',
      tracks: [track],
      loadAttachment,
    }

    controller.requestTrack(source, track.trackId)
    controller.reportPlayback({ activeTrackId: track.trackId, phase: 'ready', playing: true })

    expect(controller.source.value).toBe(source)
    expect(controller.request.value).toEqual({ trackId: track.trackId, nonce: 1 })
    expect(controller.playback.value.playing).toBe(true)

    controller.updateSource({ ...source, tracks: [...source.tracks] })
    expect(controller.playback.value).toEqual({
      activeTrackId: track.trackId,
      phase: 'ready',
      playing: true,
    })

    controller.requestTrack(controller.source.value!, track.trackId)
    expect(controller.request.value).toEqual({ trackId: track.trackId, nonce: 2 })

    controller.close()
    expect(controller.source.value).toBeNull()
    expect(controller.request.value).toBeNull()
    expect(controller.playback.value).toEqual({
      activeTrackId: null,
      phase: 'idle',
      playing: false,
    })
  })
})
