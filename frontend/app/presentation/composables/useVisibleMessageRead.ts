import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch, type Ref } from 'vue'

import type { TimelineMessage } from '../../application/messaging/timeline-message'

/** DOM visibility belongs to presentation; transport only receives a scoped cursor. */
export function useVisibleMessageRead(
  timeline: Ref<HTMLElement | null>,
  conversationId: () => string | null,
  messages: () => readonly TimelineMessage[],
  enabled: () => boolean,
  markRead: (conversationId: string, sequence: number) => Promise<boolean>,
): void {
  let active = true
  let frame: number | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let observer: ResizeObserver | null = null
  let intersection: IntersectionObserver | null = null
  let observedRoot: HTMLElement | null = null
  const observed = new Set<HTMLElement>()
  const intersecting = new Set<HTMLElement>()
  let running = false
  let acknowledged: { conversationId: string, sequence: number } | null = null
  const available = computed(() => new Map(messages()
    .filter(message => message.conversationId === conversationId() && message.contentState === 'available')
    .map(message => [message.messageId, message.sequence])))

  function schedule(): void {
    if (!active || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      void report()
    })
  }

  async function report(): Promise<void> {
    const container = timeline.value
    const id = conversationId()
    if (
      running || !active || !enabled() || !id || !container?.isConnected
      || document.visibilityState !== 'visible' || !document.hasFocus()
      || container.clientHeight <= 0
    ) return
    const viewport = window.visualViewport
    const rect = container.getBoundingClientRect()
    const top = Math.max(rect.top, viewport?.offsetTop ?? 0)
    const bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0)
      + (viewport?.height ?? window.innerHeight))
    const left = Math.max(rect.left, viewport?.offsetLeft ?? 0)
    const right = Math.min(rect.right, (viewport?.offsetLeft ?? 0)
      + (viewport?.width ?? window.innerWidth))
    if (bottom <= top || right <= left) return
    let sequence = 0
    const candidates = intersection ? intersecting : container.querySelectorAll<HTMLElement>('[data-message-id]')
    for (const element of candidates) {
      const candidate = available.value.get(element.dataset.messageId ?? '')
      if (!candidate || candidate <= sequence) continue
      const bounds = element.getBoundingClientRect()
      const visibleTop = Math.max(top, bounds.top)
      const visibleBottom = Math.min(bottom, bounds.bottom)
      const visibleLeft = Math.max(left, bounds.left)
      const visibleRight = Math.min(right, bounds.right)
      // A clipped pixel is not a viewed message. Tall attachments can qualify
      // without fitting their entire bubble into the viewport.
      if (visibleBottom - visibleTop < Math.min(24, bounds.height)
        || visibleRight - visibleLeft <= 0 || bounds.height <= 0) continue
      const hit = document.elementFromPoint(
        (visibleLeft + visibleRight) / 2,
        (visibleTop + visibleBottom) / 2,
      )
      if (hit && element.contains(hit)) sequence = candidate
    }
    if (sequence <= 0 || (acknowledged?.conversationId === id
      && acknowledged.sequence >= sequence)) return
    running = true
    try {
      if (await markRead(id, sequence)) acknowledged = { conversationId: id, sequence }
      else if (active) retry = setTimeout(retryNow, 2000)
    } finally {
      running = false
    }
    // Messages/scroll may have changed while the request was in flight.
    if (retry === null) schedule()
  }

  function refresh(): void {
    observer?.disconnect()
    const container = timeline.value
    if (container && active) {
      if (observedRoot !== container && typeof IntersectionObserver !== 'undefined') {
        intersection?.disconnect()
        observed.clear()
        intersecting.clear()
        observedRoot = container
        intersection = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) continue
            if (entry.isIntersecting) intersecting.add(entry.target)
            else intersecting.delete(entry.target)
          }
          schedule()
        }, { root: container })
      }
      observer?.observe(container)
      const elements = new Set(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      for (const element of observed) {
        if (elements.has(element)) continue
        intersection?.unobserve(element)
        observed.delete(element)
        intersecting.delete(element)
      }
      for (const element of elements) {
        observer?.observe(element)
        if (observed.has(element)) continue
        observed.add(element)
        intersection?.observe(element)
      }
    }
    schedule()
  }

  function cancel(): void {
    if (frame !== null) cancelAnimationFrame(frame)
    if (retry !== null) clearTimeout(retry)
    frame = null
    retry = null
  }

  function retryNow(): void {
    if (retry !== null) clearTimeout(retry)
    retry = null
    schedule()
  }

  watch([timeline, conversationId, messages, enabled], refresh, { flush: 'post' })
  onMounted(() => {
    observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('pointerup', schedule, true)
    document.addEventListener('keyup', schedule, true)
    document.addEventListener('visibilitychange', retryNow)
    window.addEventListener('focus', retryNow)
    window.addEventListener('online', retryNow)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    refresh()
  })
  onDeactivated(() => {
    active = false
    observer?.disconnect()
    intersection?.disconnect()
    observedRoot = null
    observed.clear()
    intersecting.clear()
    cancel()
  })
  onActivated(() => {
    active = true
    refresh()
  })
  onBeforeUnmount(() => {
    active = false
    cancel()
    observer?.disconnect()
    intersection?.disconnect()
    document.removeEventListener('scroll', schedule, true)
    document.removeEventListener('pointerup', schedule, true)
    document.removeEventListener('keyup', schedule, true)
    document.removeEventListener('visibilitychange', retryNow)
    window.removeEventListener('focus', retryNow)
    window.removeEventListener('online', retryNow)
    window.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('scroll', schedule)
  })
}
