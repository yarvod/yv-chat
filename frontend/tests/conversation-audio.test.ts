import { describe, expect, it } from 'vitest'

import {
  audioTrackTitle,
  conversationAudioTracks,
  isAudioAttachment,
} from '../app/application/messaging/conversation-audio'
import type { Conversation } from '../app/domain/messaging/models'

const conversation: Conversation = {
  conversationId: 'conversation-1',
  conversationType: 'group',
  title: 'Музыка',
  createdBy: 'user-1',
  createdAt: '2026-08-31T10:00:00Z',
  updatedAt: '2026-08-31T10:00:00Z',
  members: [{
    userId: 'user-1',
    username: 'yarik',
    displayName: 'Ярик',
    role: 'owner',
    joinedAt: '2026-08-31T10:00:00Z',
    leftAt: null,
  }],
}

describe('conversation audio playlist', () => {
  it('recognizes audio MIME types and a bounded extension fallback', () => {
    expect(isAudioAttachment({
      attachmentId: 'audio-1',
      kind: 'file',
      name: 'track.bin',
      contentType: 'audio/mpeg; charset=binary',
      byteSize: 1,
    })).toBe(true)
    expect(isAudioAttachment({
      attachmentId: 'audio-2',
      kind: 'file',
      name: 'VOICE.OPUS',
      contentType: 'application/octet-stream',
      byteSize: 1,
    })).toBe(true)
    expect(isAudioAttachment({
      attachmentId: 'document-1',
      kind: 'file',
      name: 'track.mp3.pdf',
      contentType: 'application/pdf',
      byteSize: 1,
    })).toBe(false)
    expect(isAudioAttachment({
      attachmentId: 'video-1',
      kind: 'video',
      name: 'concert.mp4',
      contentType: 'audio/mp4',
      byteSize: 1,
    })).toBe(false)
  })

  it('builds an oldest-to-newest playlist with decrypted display metadata', () => {
    const tracks = conversationAudioTracks([
      {
        messageId: 'message-2',
        sequence: 22,
        senderUserId: 'unknown-user',
        createdAt: '2026-08-31T10:02:00Z',
        expiresAt: '2026-09-30T10:02:00Z',
        attachment: {
          attachmentId: 'audio-2',
          kind: 'file',
          name: 'Second.flac',
          contentType: 'audio/flac',
          byteSize: 2,
        },
      },
      {
        messageId: 'message-1',
        sequence: 7,
        senderUserId: 'user-1',
        createdAt: '2026-08-31T10:01:00Z',
        expiresAt: '2026-09-30T10:01:00Z',
        attachment: {
          attachmentId: 'audio-1',
          kind: 'file',
          name: 'First song.MP3',
          contentType: 'application/octet-stream',
          byteSize: 1,
        },
      },
    ], conversation)

    expect(tracks.map(track => ({
      trackId: track.trackId,
      title: track.title,
      senderName: track.senderName,
    }))).toEqual([
      { trackId: 'message-1:audio-1', title: 'First song', senderName: 'Ярик' },
      { trackId: 'message-2:audio-2', title: 'Second', senderName: 'Участник' },
    ])
    expect(audioTrackTitle('.mp3')).toBe('.mp3')
  })
})
