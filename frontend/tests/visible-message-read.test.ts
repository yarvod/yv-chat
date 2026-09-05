import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TimelineMessage } from '../app/application/messaging/timeline-message'
import { useVisibleMessageRead } from '../app/presentation/composables/useVisibleMessageRead'

const message = (sequence: number): TimelineMessage => ({
  messageId: `m${sequence}`, conversationId: 'chat', clientMessageId: `c${sequence}`,
  senderUserId: 'peer', senderDeviceId: 'device', protocolVersion: 1,
  cryptoGenerationId: null, cryptoEpoch: null, sequence,
  createdAt: '2026-09-05T10:00:00Z', expiresAt: '2026-10-05T10:00:00Z',
  ciphertextBase64: 'aGk=', deletionReason: null, deletedAt: null,
  contentState: 'available', displayBody: 'hi', contentSecure: false,
})
let wrapper: VueWrapper
let frames: FrameRequestCallback[]
let focused: boolean
let covered: boolean
let hidden: boolean
let positions: Map<string, [number, number]>
let resize: () => void
let intersections: TestIntersectionObserver[]

class TestIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
  private targets = new Set<Element>()
  constructor(private callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null
    intersections.push(this)
  }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  update() {
    const entries = [...this.targets].map(target => {
      const rect = target.getBoundingClientRect()
      return { target, boundingClientRect: rect, intersectionRect: rect, rootBounds: null,
        time: 0, intersectionRatio: 1, isIntersecting: rect.top < 400 && rect.bottom > 100 }
    })
    this.callback(entries, this)
  }
}

beforeEach(() => {
  frames = []
  intersections = []
  positions = new Map([['m1', [110, 160]], ['m2', [450, 500]]])
  focused = true
  covered = false
  hidden = false
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const [top, bottom] = positions.get(this.dataset.messageId ?? '') ?? [100, 400]
    return new DOMRect(0, top, 300, bottom - top)
  })
  vi.spyOn(document, 'elementFromPoint').mockImplementation((_x, y) => {
    if (covered) return document.body
    const entry = [...positions].find(([, [top, bottom]]) => y >= top && y <= bottom)
    return entry ? document.querySelector(`[data-message-id="${entry[0]}"]`) : null
  })
})

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function paint(): Promise<void> {
  await nextTick()
  for (const observer of intersections) observer.update()
  const pending = frames.splice(0)
  for (const callback of pending) callback(0)
  await flushPromises()
}

function setup(mark = vi.fn().mockResolvedValue(true)) {
  const enabled = ref(true)
  const visible = ref(true)
  const messages = ref([message(1), message(2)])
  const Panel = defineComponent({
    setup() {
      const timeline = ref<HTMLElement | null>(null)
      useVisibleMessageRead(timeline, () => 'chat', () => messages.value, () => enabled.value, mark)
      return () => h('div', { ref: timeline }, messages.value.map(item => h('article', {
        'data-message-id': item.messageId,
      }, item.displayBody)))
    },
  })
  wrapper = mount(defineComponent({
    setup: () => () => h(KeepAlive, {}, { default: () => visible.value ? h(Panel) : null }),
  }), { attachTo: document.body })
  return { mark, enabled, visible, messages }
}

describe('visible message read receipts', () => {
  it('uses viewport geometry as a fallback without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { mark } = setup()
    await paint()
    expect(mark).toHaveBeenCalledWith('chat', 1)
  })

  it('reports only painted viewport messages and advances immediately on scroll', async () => {
    const { mark } = setup()
    await paint()
    expect(mark).toHaveBeenCalledWith('chat', 1)
    positions.set('m2', [350, 390])
    document.dispatchEvent(new Event('scroll'))
    await paint()
    expect(mark).toHaveBeenLastCalledWith('chat', 2)
    document.dispatchEvent(new Event('scroll'))
    await paint()
    expect(mark).toHaveBeenCalledTimes(2)
  })

  it.each(['focus', 'hidden', 'covered', 'restoring'] as const)('does not read while %s blocks viewing', async block => {
    const { mark, enabled } = setup()
    focused = block !== 'focus'
    hidden = block === 'hidden'
    covered = block === 'covered'
    enabled.value = block !== 'restoring'
    await paint()
    expect(mark).not.toHaveBeenCalled()
    focused = true
    hidden = false
    covered = false
    enabled.value = true
    window.dispatchEvent(new Event('focus'))
    await paint()
    expect(mark).toHaveBeenCalledWith('chat', 1)
  })

  it('ignores unreadable content, a clipped pixel and content below the viewport', async () => {
    const { mark, messages } = setup()
    messages.value = [{ ...message(1), contentState: 'unavailable' }, message(2)]
    positions.set('m2', [399, 450])
    await paint()
    expect(mark).not.toHaveBeenCalled()
    positions.set('m2', [150, 1400])
    resize()
    await paint()
    expect(mark).toHaveBeenCalledWith('chat', 2)
  })

  it('rechecks new messages without a scroll or fallback poll', async () => {
    const { mark, messages } = setup()
    await paint()
    positions.set('m3', [200, 250])
    messages.value = [...messages.value, message(3)]
    await paint()
    expect(mark).toHaveBeenLastCalledWith('chat', 3)
  })

  it('stops in a kept-alive inactive page and rechecks on return', async () => {
    const { mark, visible, messages } = setup()
    await paint()
    visible.value = false
    await paint()
    positions.set('m3', [200, 250])
    messages.value = [...messages.value, message(3)]
    window.dispatchEvent(new Event('focus'))
    await paint()
    expect(mark).toHaveBeenCalledTimes(1)
    visible.value = true
    await paint()
    expect(mark).toHaveBeenLastCalledWith('chat', 3)
  })

  it('serializes requests and rechecks the latest visible message after completion', async () => {
    let finish: (value: boolean) => void = () => undefined
    const mark = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
      .mockResolvedValue(true)
    setup(mark)
    await paint()
    positions.set('m2', [200, 250])
    document.dispatchEvent(new Event('scroll'))
    await paint()
    expect(mark).toHaveBeenCalledTimes(1)
    finish(true)
    await flushPromises()
    await paint()
    expect(mark).toHaveBeenLastCalledWith('chat', 2)
  })

  it('retries a failed read while still visible, but never retries in a background window', async () => {
    const mark = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    setup(mark)
    await paint()
    focused = false
    await vi.advanceTimersByTimeAsync(2000)
    await paint()
    expect(mark).toHaveBeenCalledTimes(1)
    focused = true
    window.dispatchEvent(new Event('focus'))
    await paint()
    expect(mark).toHaveBeenCalledTimes(2)
  })
})
