import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  VideoNoteRecorder,
  VideoNoteRecordingSession,
} from '../app/application/ports/video-note-recorder'
import VideoNoteCapture from '../app/components/chat/VideoNoteCapture.vue'

function recordingHarness() {
  const session: VideoNoteRecordingSession = {
    previewStream: new MediaStream(),
    facingMode: 'user',
    recording: false,
    start: vi.fn(),
    switchCamera: vi.fn().mockResolvedValue(new MediaStream()),
    stop: vi.fn().mockResolvedValue({
      body: new Blob(['compact-video'], { type: 'video/webm' }),
      contentType: 'video/webm',
      durationSeconds: 2,
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
  const recorder: VideoNoteRecorder = {
    isSupported: () => true,
    open: vi.fn().mockResolvedValue(session),
  }
  return { recorder, session }
}

function pointer(type: string, pointerId: number, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX, clientY })
}

describe('video note capture gestures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:video-note-review-${blob.size}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('suppresses native long-press selection and context gestures on the capture button', () => {
    const { recorder } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    const button = wrapper.get('.video-note-button').element

    for (const type of ['touchstart', 'contextmenu', 'selectstart', 'dragstart']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented, type).toBe(true)
    }
  })

  it('records on hold/release and emits one compact video note', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 7, 200, 500))
    await flushPromises()
    expect(session.start).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1_200)
    window.dispatchEvent(pointer('pointerup', 7, 200, 500))
    await flushPromises()

    expect(session.stop).toHaveBeenCalledOnce()
    expect(session.cancel).not.toHaveBeenCalled()
    expect(wrapper.emitted('recorded')?.[0]?.[0]).toMatchObject({
      contentType: 'video/webm',
      durationSeconds: 2,
    })
  })

  it('cancels on a left swipe without producing upload bytes', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 3, 200, 500))
    await flushPromises()
    window.dispatchEvent(pointer('pointermove', 3, 110, 505))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Отпустите, чтобы отменить')
    window.dispatchEvent(pointer('pointerup', 3, 110, 505))
    await flushPromises()

    expect(session.cancel).toHaveBeenCalledOnce()
    expect(session.stop).not.toHaveBeenCalled()
    expect(wrapper.emitted('recorded')).toBeUndefined()
  })

  it('locks on an upward swipe, keeps recording after release and flips camera', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 9, 200, 500))
    await flushPromises()
    window.dispatchEvent(pointer('pointermove', 9, 198, 410))
    window.dispatchEvent(pointer('pointerup', 9, 198, 410))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Запись зафиксирована')
    expect(session.stop).not.toHaveBeenCalled()

    await wrapper.get('button[aria-label="Переключить камеру"]').trigger('click')
    expect(session.switchCamera).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1_000)
    await wrapper.get('.video-note-recorder__actions .primary').trigger('click')
    await flushPromises()
    expect(session.stop).toHaveBeenCalledOnce()
  })

  it('stops at 60 seconds and waits for explicit send with a full progress ring', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 11, 200, 500))
    await flushPromises()
    window.dispatchEvent(pointer('pointermove', 11, 200, 410))

    vi.advanceTimersByTime(30_000)
    await wrapper.vm.$nextTick()
    const halfwayProgress = wrapper.get('[role="progressbar"]')
    expect(halfwayProgress.attributes('aria-valuenow')).toBe('30')
    expect(halfwayProgress.attributes('style')).toContain('--video-note-recording-progress: 180deg')

    vi.advanceTimersByTime(30_000)
    await flushPromises()

    expect(session.stop).toHaveBeenCalledOnce()
    expect(session.cancel).not.toHaveBeenCalled()
    expect(wrapper.emitted('recorded')).toBeUndefined()
    expect(wrapper.text()).toContain('Минута записана — отправить или удалить?')
    expect(wrapper.get('.video-note-recorder__time').text()).toBe('1:00')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('60')
    expect(wrapper.get('[role="progressbar"]').classes()).toContain('is-review')
    expect(wrapper.get<HTMLVideoElement>('.video-note-recorder__preview video').attributes('src'))
      .toBe('blob:video-note-review-13')

    await wrapper.get('.video-note-recorder__review-actions .primary').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('recorded')).toHaveLength(1)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-note-review-13')
  })

  it('deletes a max-duration review without emitting or uploading it', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 12, 200, 500))
    await flushPromises()
    vi.advanceTimersByTime(60_000)
    await flushPromises()

    expect(session.stop).toHaveBeenCalledOnce()
    await wrapper.get('.video-note-recorder__review-actions .danger').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('recorded')).toBeUndefined()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-note-review-13')
  })

  it('keeps a completed review across backgrounding and releases it on unmount', async () => {
    const { recorder, session } = recordingHarness()
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 14, 200, 500))
    await flushPromises()
    vi.advanceTimersByTime(60_000)
    await flushPromises()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(wrapper.text()).toContain('Минута записана — отправить или удалить?')
    expect(session.cancel).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-note-review-13')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('preserves an upward lock gesture while camera permission is still opening', async () => {
    const { recorder, session } = recordingHarness()
    let resolveOpen: ((session: VideoNoteRecordingSession) => void) | null = null
    recorder.open = vi.fn(() => new Promise(resolve => { resolveOpen = resolve }))
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })
    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 13, 200, 500))
    window.dispatchEvent(pointer('pointermove', 13, 200, 410))
    resolveOpen?.(session)
    await flushPromises()

    expect(session.start).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Запись зафиксирована')
    expect(session.stop).not.toHaveBeenCalled()
    await wrapper.get('.video-note-recorder__actions .danger').trigger('click')
    await flushPromises()
    expect(session.cancel).toHaveBeenCalledOnce()
  })

  it('explains an already denied PWA permission and permits another hold after settings change', async () => {
    const { recorder, session } = recordingHarness()
    recorder.open = vi.fn()
      .mockRejectedValueOnce({ code: 'permission' })
      .mockResolvedValueOnce(session)
    const wrapper = mount(VideoNoteCapture, {
      props: { recorder, disabled: false },
      global: { stubs: { Teleport: true } },
    })

    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 15, 200, 500))
    await flushPromises()

    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('Если системный запрос не появился')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    wrapper.get('.video-note-button').element.dispatchEvent(pointer('pointerdown', 16, 200, 500))
    await flushPromises()

    expect(recorder.open).toHaveBeenCalledTimes(2)
    expect(session.start).toHaveBeenCalledOnce()
    wrapper.unmount()
    await flushPromises()
    expect(session.cancel).toHaveBeenCalledOnce()
  })
})
