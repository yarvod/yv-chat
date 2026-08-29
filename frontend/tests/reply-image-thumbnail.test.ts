import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReplyImageThumbnail from '../app/components/chat/ReplyImageThumbnail.vue'

const originalIntersectionObserver = globalThis.IntersectionObserver
const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

afterEach(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: originalIntersectionObserver,
  })
  if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.restoreAllMocks()
})

describe('reply image thumbnail', () => {
  it('loads near the viewport and revokes its transient object URL on unmount', async () => {
    let intersect: (() => void) | undefined
    class DeferredIntersectionObserver {
      constructor(private readonly callback: IntersectionObserverCallback) {
        intersect = () => callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }

      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: DeferredIntersectionObserver,
    })
    const createObjectURL = vi.fn(() => 'blob:reply-small')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const source = new Blob(['photo'], { type: 'image/jpeg' })
    const thumbnail = new Blob(['small'], { type: 'image/png' })
    const loadAttachment = vi.fn().mockResolvedValue(source)
    const createThumbnail = vi.fn().mockResolvedValue({
      body: thumbnail,
      pixelWidth: 800,
      pixelHeight: 600,
    })
    const attachment = {
      attachmentId: 'photo-1',
      kind: 'image' as const,
      name: 'cat.jpg',
      contentType: 'image/jpeg',
      byteSize: source.size,
    }
    const wrapper = mount(ReplyImageThumbnail, {
      props: {
        conversationId: 'conversation-1',
        expiresAt: '2026-09-30T12:00:00Z',
        attachment,
        loadAttachment,
        createThumbnail,
      },
    })

    expect(loadAttachment).not.toHaveBeenCalled()
    intersect?.()
    await flushPromises()

    expect(loadAttachment).toHaveBeenCalledWith(
      'conversation-1',
      attachment,
      '2026-09-30T12:00:00Z',
    )
    expect(createThumbnail).toHaveBeenCalledWith(source, 96)
    expect(wrapper.get('img').attributes('src')).toBe('blob:reply-small')
    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reply-small')
  })
})
