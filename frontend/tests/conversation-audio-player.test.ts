import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationAudioTrack } from '../app/application/messaging/conversation-audio'
import type { AudioMediaSession } from '../app/application/ports/audio-media-session'
import ConversationAudioPlayer from '../app/components/chat/ConversationAudioPlayer.vue'

const first: ConversationAudioTrack = {
  trackId: 'message-1:audio-1',
  messageId: 'message-1',
  sequence: 1,
  senderUserId: 'user-1',
  senderName: 'Ярик',
  title: 'Первая песня',
  createdAt: '2026-08-31T10:00:00Z',
  expiresAt: '2026-09-30T10:00:00Z',
  attachment: {
    attachmentId: 'audio-1',
    kind: 'file',
    name: 'Первая песня.mp3',
    contentType: 'audio/mpeg',
    byteSize: 128,
  },
}
const second: ConversationAudioTrack = {
  ...first,
  trackId: 'message-2:audio-2',
  messageId: 'message-2',
  sequence: 2,
  title: 'Вторая песня',
  attachment: {
    ...first.attachment,
    attachmentId: 'audio-2',
    name: 'Вторая песня.mp3',
  },
}

function mediaSession(): AudioMediaSession {
  return {
    setMetadata: vi.fn(),
    setPlaybackState: vi.fn(),
    setPosition: vi.fn(),
    setControls: vi.fn(() => vi.fn()),
    clear: vi.fn(),
  }
}

describe('conversation audio player', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:audio-${blob.size}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps one audio element across compact, fullscreen and playlist navigation', async () => {
    const loadAttachment = vi.fn(async (_conversationId, attachment) => (
      new Blob(['x'.repeat(attachment.byteSize)], { type: attachment.contentType })
    ))
    const session = mediaSession()
    const wrapper = mount(ConversationAudioPlayer, {
      props: {
        conversationId: 'conversation-1',
        conversationTitle: 'Музыкальный чат',
        tracks: [first, second],
        request: { trackId: first.trackId, nonce: 1 },
        loadAttachment,
        mediaSession: session,
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(loadAttachment).toHaveBeenCalledWith(
      'conversation-1',
      first.attachment,
      first.expiresAt,
    )
    expect(session.setMetadata).toHaveBeenCalledWith({
      title: 'Первая песня',
      artist: 'Ярик',
      album: 'Музыкальный чат',
    })
    expect(wrapper.findAll('audio')).toHaveLength(1)
    expect(wrapper.get('.conversation-audio-player__copy').text()).toContain('Первая песня')

    const audio = wrapper.get<HTMLAudioElement>('audio')
    Object.defineProperty(audio.element, 'duration', { configurable: true, value: 180 })
    Object.defineProperty(audio.element, 'currentTime', {
      configurable: true,
      value: 35,
      writable: true,
    })
    await audio.trigger('loadedmetadata')
    await audio.trigger('timeupdate')
    await audio.trigger('play')
    expect(wrapper.get('.conversation-audio-player__copy').text()).toContain('0:35 / 3:00')

    await wrapper.get('[aria-label="Открыть плеер на весь экран"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Плейлист этого чата')
    expect(wrapper.get('[role="dialog"]').text()).toContain('2 комп.')

    await wrapper.get('[role="dialog"] [aria-label="Следующая композиция"]').trigger('click')
    await flushPromises()
    expect(loadAttachment).toHaveBeenLastCalledWith(
      'conversation-1',
      second.attachment,
      second.expiresAt,
    )
    expect(wrapper.get('.audio-player-fullscreen__track-copy').text()).toContain('Вторая песня')

    await wrapper.get('[aria-label="Изменить скорость воспроизведения"]').trigger('click')
    expect(wrapper.get('[aria-label="Изменить скорость воспроизведения"]').text()).toBe('1.25×')
    await wrapper.get('[aria-label="Повтор выключен"]').trigger('click')
    expect(wrapper.get('[aria-label="Повторять весь плейлист"]').exists()).toBe(true)

    await wrapper.get('[aria-label="Свернуть плеер"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('.conversation-audio-player__copy').text()).toContain('Вторая песня')

    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('shows a recoverable error when an expired track cannot load', async () => {
    const wrapper = mount(ConversationAudioPlayer, {
      props: {
        conversationId: 'conversation-1',
        conversationTitle: 'Музыкальный чат',
        tracks: [first],
        request: { trackId: first.trackId, nonce: 1 },
        loadAttachment: vi.fn().mockRejectedValue(new Error('expired')),
        mediaSession: mediaSession(),
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()
    await wrapper.get('.conversation-audio-player__copy').trigger('click')

    expect(wrapper.get('[role="status"]').text()).toContain('срок хранения истёк')
    await wrapper.get('.audio-player-fullscreen__play').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Аудио недоступно')
  })
})
