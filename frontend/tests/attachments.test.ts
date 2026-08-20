import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decodeGroupMessageContent,
  encodeGroupMessageContent,
} from '../app/application/messaging/group-message-content'
import { UploadGroupAttachment } from '../app/application/messaging/upload-group-attachment'
import { DownloadGroupAttachment } from '../app/application/messaging/download-group-attachment'
import type { AttachmentGateway } from '../app/application/ports/attachment-gateway'
import MessageAttachments from '../app/components/chat/MessageAttachments.vue'

const attachment = {
  attachmentId: 'attachment-1',
  kind: 'image' as const,
  name: 'photo.png',
  contentType: 'image/png',
  byteSize: 321,
}
const expiresAt = '2026-08-13T12:00:00Z'
const originalIntersectionObserver = globalThis.IntersectionObserver

function dispatchTouch(
  element: Element,
  type: 'touchstart' | 'touchmove',
  touches: readonly { clientX: number, clientY: number }[],
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: touches },
  })
  element.dispatchEvent(event)
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => `blob:test-${blob.size}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  class ImmediateIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element): void {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never)
    }

    disconnect(): void {}
    unobserve(): void {}
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: ImmediateIntersectionObserver,
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: originalIntersectionObserver,
  })
})

describe('group message attachment content', () => {
  it('round-trips bounded metadata while preserving legacy text messages', () => {
    const video = {
      attachmentId: 'video-1',
      kind: 'video' as const,
      name: 'clip.mp4',
      contentType: 'video/mp4',
      byteSize: 30 * 1024 * 1024,
    }
    const encoded = encodeGroupMessageContent({ text: 'caption', attachments: [attachment, video] })

    expect(decodeGroupMessageContent(encoded)).toEqual({
      text: 'caption',
      attachments: [attachment, video],
    })
    expect(decodeGroupMessageContent('legacy group text')).toEqual({
      text: 'legacy group text',
      attachments: [],
    })
    expect(decodeGroupMessageContent('yv-chat/group-content/v1:{broken')).toEqual({
      text: 'yv-chat/group-content/v1:{broken',
      attachments: [],
    })
  })

  it('rejects an empty content envelope', () => {
    expect(() => encodeGroupMessageContent({ text: ' ', attachments: [] })).toThrow(TypeError)
  })

  it('round-trips video-note presentation while rejecting malformed note metadata', () => {
    const videoNote = {
      attachmentId: 'video-note-1',
      kind: 'video' as const,
      name: 'video-note.webm',
      contentType: 'video/webm',
      byteSize: 2_100_000,
      presentation: 'video_note' as const,
      durationSeconds: 42,
    }
    const encoded = encodeGroupMessageContent({ text: '', attachments: [videoNote] })
    expect(decodeGroupMessageContent(encoded)).toEqual({ text: '', attachments: [videoNote] })
    expect(() => encodeGroupMessageContent({
      text: '',
      attachments: [{ ...videoNote, durationSeconds: 61 }],
    })).toThrow('invalid group attachment metadata')
    expect(() => encodeGroupMessageContent({
      text: '',
      attachments: [{ ...attachment, presentation: 'video_note', durationSeconds: 10 }],
    })).toThrow('invalid group attachment metadata')
  })

  it('round-trips only GIF/WebP sticker presentation', () => {
    const sticker = {
      attachmentId: 'sticker-1',
      kind: 'image' as const,
      name: 'party.webp',
      contentType: 'image/webp',
      byteSize: 2_100,
      presentation: 'sticker' as const,
    }
    const encoded = encodeGroupMessageContent({ text: '', attachments: [sticker] })
    expect(decodeGroupMessageContent(encoded)).toEqual({ text: '', attachments: [sticker] })
    expect(() => encodeGroupMessageContent({
      text: '',
      attachments: [{ ...sticker, contentType: 'image/png' }],
    })).toThrow('invalid group attachment metadata')
  })
})

describe('group attachment upload use case', () => {
  it('normalizes display name and rejects direct-chat downgrade', async () => {
    const upload = vi.fn<AttachmentGateway['upload']>(async (
      conversationId,
      source,
      onProgress,
    ) => {
      onProgress?.({ uploadedBytes: source.byteSize, totalBytes: source.byteSize })
      return {
        attachmentId: 'server-attachment',
        clientAttachmentId: source.clientAttachmentId,
        conversationId,
        kind: source.kind,
        contentType: source.contentType,
        byteSize: source.byteSize,
        sha256Digest: 'a'.repeat(64),
        createdAt: '2026-08-12T12:00:00Z',
        expiresAt: '2026-08-13T12:00:00Z',
      }
    })
    const useCase = new UploadGroupAttachment(
      { upload, download: vi.fn() },
      { create: () => 'client-attachment' },
    )
    const body = new Blob(['image'], { type: 'image/png' })

    const source = {
      name: `../camera${String.fromCharCode(0)}.png`,
      type: 'image/png',
      size: body.size,
      body,
    }
    const onProgress = vi.fn()
    await expect(useCase.execute('group-1', 'group', source, onProgress)).resolves.toMatchObject({
      attachmentId: 'server-attachment',
      name: 'camera.png',
      kind: 'image',
    })
    expect(onProgress).toHaveBeenCalledWith({ uploadedBytes: body.size, totalBytes: body.size })
    await useCase.execute('group-1', 'group', source)
    expect(upload.mock.calls[1]?.[1].clientAttachmentId).toBe('client-attachment')
    const video = new Blob(['video'], { type: 'video/mp4' })
    await expect(useCase.execute('group-1', 'group', {
      name: 'clip.mp4',
      type: 'video/mp4',
      size: video.size,
      body: video,
    })).resolves.toMatchObject({ kind: 'video', contentType: 'video/mp4' })
    const sticker = new Blob(['sticker'], { type: 'image/gif' })
    await expect(useCase.execute('group-1', 'group', {
      name: 'party.gif',
      type: 'image/gif',
      size: sticker.size,
      body: sticker,
      presentation: 'sticker',
    })).resolves.toMatchObject({ kind: 'image', presentation: 'sticker' })
    await expect(useCase.execute('group-1', 'group', {
      name: 'video-note.mp4',
      type: 'video/mp4',
      size: video.size,
      body: video,
      presentation: 'video_note',
      durationSeconds: 12,
    })).resolves.toMatchObject({
      kind: 'video',
      presentation: 'video_note',
      durationSeconds: 12,
    })
    const oversizedNote = new Blob(['bounded'], { type: 'video/mp4' })
    Object.defineProperty(oversizedNote, 'size', { value: 8 * 1024 * 1024 + 1 })
    await expect(useCase.execute('group-1', 'group', {
      name: 'oversized-note.mp4',
      type: 'video/mp4',
      size: oversizedNote.size,
      body: oversizedNote,
      presentation: 'video_note',
      durationSeconds: 60,
    })).rejects.toThrow('invalid attachment source')
    const arbitrary = new Blob(['custom'])
    await expect(useCase.execute('group-1', 'group', {
      name: 'archive.unknown',
      type: '',
      size: arbitrary.size,
      body: arbitrary,
    })).resolves.toMatchObject({ kind: 'file', contentType: 'application/octet-stream' })
    await expect(useCase.execute('direct-1', 'direct', {
      name: 'secret.png',
      type: 'image/png',
      size: body.size,
      body,
    })).rejects.toThrow('direct attachments require E2EE')
  })
})

describe('group attachment download use case', () => {
  it('accepts only a bounded binary response matching message metadata', async () => {
    const body = new Blob(['photo'], { type: 'image/png' })
    const gateway: AttachmentGateway = {
      upload: vi.fn(),
      download: vi.fn().mockResolvedValue(body),
    }
    const useCase = new DownloadGroupAttachment(gateway)

    await expect(useCase.execute('user-1', 'device-1', 'conversation-1', {
      ...attachment,
      byteSize: body.size,
    }, expiresAt)).resolves.toBe(body)
    useCase.clearMemory('user-1', 'device-1')
    await expect(useCase.execute(
      'user-1',
      'device-1',
      'conversation-1',
      attachment,
      expiresAt,
    )).rejects.toThrow(
      'attachment response mismatch',
    )
  })

  it('coalesces downloads and reuses a bounded hot cache per account device', async () => {
    const body = new Blob(['photo'], { type: 'image/png' })
    const gateway: AttachmentGateway = {
      upload: vi.fn(),
      download: vi.fn().mockResolvedValue(body),
    }
    const cache = {
      load: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      clear: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      close: vi.fn(),
    }
    const useCase = new DownloadGroupAttachment(
      gateway,
      cache,
      1024,
      () => Date.parse('2026-08-13T11:59:00Z'),
    )
    const item = { ...attachment, byteSize: body.size }

    const first = useCase.execute('user-1', 'device-1', 'conversation-1', item, expiresAt)
    const concurrent = useCase.execute('user-1', 'device-1', 'conversation-1', item, expiresAt)
    await expect(Promise.all([first, concurrent])).resolves.toEqual([body, body])
    await expect(useCase.execute(
      'user-1', 'device-1', 'conversation-1', item, expiresAt,
    )).resolves.toBe(body)
    expect(gateway.download).toHaveBeenCalledOnce()
    expect(cache.load).toHaveBeenCalledOnce()
    expect(cache.store).toHaveBeenCalledOnce()

    useCase.clearMemory('user-1', 'device-1')
    cache.load.mockResolvedValue(body)
    await expect(useCase.execute(
      'user-1', 'device-1', 'conversation-1', item, expiresAt,
    )).resolves.toBe(body)
    expect(cache.load).toHaveBeenCalledTimes(2)
    expect(gateway.download).toHaveBeenCalledOnce()
  })

  it('never serves an expired attachment from the hot cache', async () => {
    const body = new Blob(['photo'], { type: 'image/png' })
    const gateway: AttachmentGateway = {
      upload: vi.fn(),
      download: vi.fn().mockResolvedValue(body),
    }
    const cache = {
      load: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      clear: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      close: vi.fn(),
    }
    let now = Date.parse('2026-08-13T11:59:00Z')
    const useCase = new DownloadGroupAttachment(gateway, cache, 1024, () => now)
    const item = { ...attachment, byteSize: body.size }

    await expect(useCase.execute(
      'user-1', 'device-1', 'conversation-1', item, expiresAt,
    )).resolves.toBe(body)
    now = Date.parse('2026-08-13T12:01:00Z')
    await expect(useCase.execute(
      'user-1', 'device-1', 'conversation-1', item, expiresAt,
    )).resolves.toBe(body)

    expect(gateway.download).toHaveBeenCalledTimes(2)
    expect(cache.load).toHaveBeenCalledTimes(2)
  })

  it('does not repopulate cache when device media is cleared during a download', async () => {
    const body = new Blob(['photo'], { type: 'image/png' })
    let resolveDownload: ((blob: Blob) => void) | undefined
    const gateway: AttachmentGateway = {
      upload: vi.fn(),
      download: vi.fn(() => new Promise<Blob>(resolve => { resolveDownload = resolve })),
    }
    const cache = {
      load: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      clear: vi.fn().mockResolvedValue({ usedBytes: 0, entryCount: 0, limitBytes: 1024 }),
      close: vi.fn(),
    }
    const useCase = new DownloadGroupAttachment(gateway, cache)
    const item = { ...attachment, byteSize: body.size }
    const request = useCase.execute(
      'user-1', 'device-1', 'conversation-1', item, expiresAt,
    )
    await vi.waitFor(() => expect(gateway.download).toHaveBeenCalledOnce())

    useCase.clearMemory('user-1', 'device-1')
    resolveDownload?.(body)

    await expect(request).resolves.toBe(body)
    expect(cache.store).not.toHaveBeenCalled()
  })
})

describe('message attachment rendering', () => {
  it('renders animated stickers frameless with an explicit motion badge', async () => {
    const sticker = {
      attachmentId: 'sticker-1',
      kind: 'image' as const,
      name: 'party.gif',
      contentType: 'image/gif',
      byteSize: 128,
      presentation: 'sticker' as const,
    }
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [sticker],
        loadAttachment: vi.fn().mockResolvedValue(
          new Blob(['x'.repeat(sticker.byteSize)], { type: sticker.contentType }),
        ),
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(wrapper.get('.message-attachments').classes()).toContain('message-attachments--sticker')
    expect(wrapper.get('.message-sticker__badge').text()).toBe('GIF')
    await wrapper.get('.message-sticker').trigger('click')
    expect(wrapper.get('[role="dialog"] img').attributes('src')).toBe('blob:test-128')
  })

  it('loads photos through the authenticated gateway and opens an in-app viewer', async () => {
    const second = { ...attachment, attachmentId: 'attachment-2', name: 'second.png' }
    const loadAttachment = vi.fn(async (_conversationId, item) => (
      new Blob(['x'.repeat(item.byteSize)], { type: item.contentType })
    ))
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [attachment, second],
        loadAttachment,
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(loadAttachment).toHaveBeenCalledWith('conversation-1', attachment, expiresAt)
    expect(wrapper.get('.message-photo img').attributes('src')).toBe('blob:test-321')
    expect(wrapper.find('a[target="_blank"]').exists()).toBe(false)
    await wrapper.findAll('.message-photo')[0]?.trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('1 / 2')
    expect(wrapper.get('[role="dialog"]').text()).toContain('100%')
    await wrapper.get('.media-viewer__image').trigger('dblclick')
    expect(wrapper.get('[role="dialog"]').text()).toContain('250%')
    await wrapper.get('button[aria-label="Уменьшить"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('200%')
    await wrapper.get('.media-viewer__image').trigger('dblclick')
    expect(wrapper.get('[role="dialog"]').text()).toContain('100%')
    const viewerImage = wrapper.get('.media-viewer__image').element
    dispatchTouch(viewerImage, 'touchstart', [
      { clientX: 50, clientY: 100 },
      { clientX: 150, clientY: 100 },
    ])
    dispatchTouch(viewerImage, 'touchmove', [
      { clientX: 0, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ])
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="dialog"]').text()).toContain('200%')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('2 / 2')
    await wrapper.get('.media-viewer__close').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('plays a supported video inside the timeline and fullscreen media viewer', async () => {
    const video = {
      attachmentId: 'video-1',
      kind: 'video' as const,
      name: 'clip.mp4',
      contentType: 'video/mp4',
      byteSize: 512,
    }
    const loadAttachment = vi.fn(async () => (
      new Blob(['x'.repeat(video.byteSize)], { type: video.contentType })
    ))
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [video],
        loadAttachment,
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(wrapper.get('.message-video').attributes('src')).toBe('blob:test-512')
    expect(wrapper.get('.message-video').attributes()).toMatchObject({
      controls: '',
      playsinline: '',
    })
    await wrapper.get('.message-video__open').trigger('click')
    expect(wrapper.get('[role="dialog"] video').attributes('src')).toBe('blob:test-512')
    expect(wrapper.get('[role="dialog"] video').attributes()).toMatchObject({
      controls: '',
      playsinline: '',
    })
    expect(wrapper.find('.media-viewer__zoom').exists()).toBe(false)
    expect(wrapper.get('[role="dialog"]').text()).toContain('1 / 1 · clip.mp4')
    await wrapper.get('.media-viewer__close').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await wrapper.get('.message-video').trigger('error')
    expect(wrapper.text()).toContain('Этот формат нельзя воспроизвести здесь')
    await wrapper.get('.message-video-fallback button').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })

  it('autoplays a visible muted video note, expands with sound and keeps its timer outside the crop', async () => {
    const videoNote = {
      attachmentId: 'video-note-1',
      kind: 'video' as const,
      name: 'video-note.webm',
      contentType: 'video/webm',
      byteSize: 420,
      presentation: 'video_note' as const,
      durationSeconds: 9,
    }
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [videoNote],
        loadAttachment: vi.fn().mockResolvedValue(
          new Blob(['x'.repeat(videoNote.byteSize)], { type: videoNote.contentType }),
        ),
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(wrapper.find('.message-video').exists()).toBe(false)
    const button = wrapper.get('.message-video-note')
    const video = wrapper.get<HTMLVideoElement>('.message-video-note video')
    expect(button.text()).toContain('00:09')
    expect(video.attributes('controls')).toBeUndefined()
    expect(video.element.autoplay).toBe(false)
    expect(video.element.muted).toBe(true)
    expect(video.element.loop).toBe(true)
    expect(video.attributes('preload')).toBe('metadata')
    expect(play).toHaveBeenCalledOnce()
    expect(wrapper.get('.message-video-note__timer').element.parentElement).toBe(button.element)
    expect(wrapper.get('.message-video-note__inner').find('.message-video-note__timer').exists())
      .toBe(false)

    Object.defineProperty(video.element, 'currentTime', {
      configurable: true,
      value: 4.2,
      writable: true,
    })
    await video.trigger('timeupdate')
    expect(button.text()).toContain('00:05')

    await button.trigger('click')
    expect(play).toHaveBeenCalledTimes(2)
    expect(button.classes()).toContain('is-expanded')
    expect(button.attributes('aria-label')).toContain('Свернуть')
    expect(video.element.muted).toBe(false)
    expect(video.element.loop).toBe(false)
    expect(video.element.currentTime).toBe(0)

    await button.trigger('click')
    expect(play).toHaveBeenCalledTimes(3)
    expect(button.classes()).not.toContain('is-expanded')
    expect(video.element.muted).toBe(true)
    expect(video.element.loop).toBe(true)

    await button.trigger('click')
    await video.trigger('ended')
    expect(play).toHaveBeenCalledTimes(5)
    expect(button.classes()).not.toContain('is-expanded')
    expect(video.element.muted).toBe(true)
    expect(video.element.loop).toBe(true)
    expect(video.element.currentTime).toBe(0)
    play.mockRestore()
  })

  it('plays video notes only while their shells intersect the viewport', async () => {
    const videoNote = {
      attachmentId: 'video-note-visible',
      kind: 'video' as const,
      name: 'visible-note.webm',
      contentType: 'video/webm',
      byteSize: 420,
      presentation: 'video_note' as const,
      durationSeconds: 9,
    }
    class ControlledIntersectionObserver {
      readonly targets = new Set<Element>()

      constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
      ) {}

      observe(target: Element): void {
        this.targets.add(target)
        if (this.options?.rootMargin === '500px 0px') {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as never,
          )
        }
      }

      disconnect(): void {
        this.targets.clear()
      }

      unobserve(target: Element): void {
        this.targets.delete(target)
      }

      trigger(isIntersecting: boolean): void {
        this.callback(
          [...this.targets].map(target => ({ isIntersecting, target } as IntersectionObserverEntry)),
          this as never,
        )
      }
    }
    const observers: ControlledIntersectionObserver[] = []
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: class extends ControlledIntersectionObserver {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options)
          observers.push(this)
        }
      },
    })
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [videoNote],
        loadAttachment: vi.fn().mockResolvedValue(
          new Blob(['x'.repeat(videoNote.byteSize)], { type: videoNote.contentType }),
        ),
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const playbackObserver = observers.find(item => item.options?.threshold === 0.01)
    expect(playbackObserver).toBeDefined()
    expect(play).not.toHaveBeenCalled()

    playbackObserver?.trigger(true)
    await flushPromises()
    expect(play).toHaveBeenCalledOnce()

    const pauseCallsBeforeLeave = pause.mock.calls.length
    playbackObserver?.trigger(false)
    await flushPromises()
    expect(pause).toHaveBeenCalledTimes(pauseCallsBeforeLeave + 1)

    playbackObserver?.trigger(true)
    await flushPromises()
    expect(play).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    play.mockRestore()
    pause.mockRestore()
  })

  it('downloads a file through the authenticated gateway without endpoint navigation', async () => {
    const file = {
      attachmentId: 'file-1',
      kind: 'file' as const,
      name: 'report.pdf',
      contentType: 'application/pdf',
      byteSize: 2048,
    }
    const loadAttachment = vi.fn().mockResolvedValue(
      new Blob(['x'.repeat(file.byteSize)], { type: 'application/octet-stream' }),
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const wrapper = mount(MessageAttachments, {
      props: { conversationId: 'conversation-1', expiresAt, attachments: [file], loadAttachment },
    })

    expect(loadAttachment).not.toHaveBeenCalled()
    await wrapper.get('.message-file').trigger('click')
    await flushPromises()
    expect(loadAttachment).toHaveBeenCalledWith('conversation-1', file, expiresAt)
    expect(click).toHaveBeenCalledOnce()
    expect(wrapper.find('a').exists()).toBe(false)
    click.mockRestore()
  })

  it('renders gallery count and an expiry-safe retry state', async () => {
    const second = { ...attachment, attachmentId: 'attachment-2', name: 'second.png' }
    const loadAttachment = vi.fn(async (_conversationId, item) => {
      if (item.attachmentId === attachment.attachmentId) throw new Error('expired')
      return new Blob(['x'.repeat(item.byteSize)], { type: item.contentType })
    })
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation-1',
        expiresAt,
        attachments: [attachment, second],
        loadAttachment,
      },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('срок хранения истёк')
    expect(wrapper.findAll('.message-photo')).toHaveLength(1)
    await wrapper.get('.message-photo').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('2 / 2')
    await wrapper.get('.attachment-unavailable button').trigger('click')
    expect(loadAttachment).toHaveBeenCalledTimes(3)
  })
})
