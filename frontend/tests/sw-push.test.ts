// @vitest-environment node

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

interface ExtendableEventLike {
  waitUntil(promise: Promise<void>): void
}

interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown }
}

interface NotificationClickEventLike extends ExtendableEventLike {
  notification: {
    data: { conversationId?: string }
    close(): void
  }
}

type EventHandler = (event: unknown) => void

function harness(options: { visible?: boolean, duplicate?: boolean } = {}) {
  const listeners = new Map<string, EventHandler>()
  const notifications: { title: string, options: Record<string, unknown> }[] = []
  const navigations: string[] = []
  let focused = 0
  const windowClient = {
    visibilityState: options.visible ? 'visible' : 'hidden',
    async navigate(url: string): Promise<void> { navigations.push(url) },
    async focus(): Promise<void> { focused += 1 },
  }
  const worker = {
    addEventListener(type: string, listener: EventHandler): void { listeners.set(type, listener) },
    clients: {
      async matchAll(): Promise<typeof windowClient[]> { return options.visible === undefined ? [] : [windowClient] },
      async openWindow(url: string): Promise<void> { navigations.push(url) },
    },
    registration: {
      async getNotifications(): Promise<object[]> { return options.duplicate ? [{}] : [] },
      async showNotification(title: string, notificationOptions: Record<string, unknown>): Promise<void> {
        notifications.push({ title, options: notificationOptions })
      },
    },
  }
  runInNewContext(
    readFileSync(new URL('../public/sw-push.js', import.meta.url), 'utf8'),
    { self: worker },
  )
  return {
    listeners,
    notifications,
    navigations,
    focused: () => focused,
  }
}

const PAYLOAD = {
  version: 1,
  event_id: '12d9b642-165a-45f0-bceb-d09778f88ff7',
  conversation_id: 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e',
  message_id: '7befbd28-1b77-48ee-8b6c-6f279fc1b92e',
  sync_required: true,
}

async function dispatchPush(
  target: ReturnType<typeof harness>,
  payload: unknown,
): Promise<void> {
  let pending = Promise.resolve()
  const event: PushEventLike = {
    data: { json: () => payload },
    waitUntil(promise) { pending = promise },
  }
  target.listeners.get('push')?.(event)
  await pending
}

describe('privacy-safe push service worker', () => {
  it('shows one generic notification only while no visible app client exists', async () => {
    const background = harness()
    await dispatchPush(background, PAYLOAD)
    expect(background.notifications).toHaveLength(1)
    expect(background.notifications[0]?.title).toBe('Новое сообщение')
    expect(JSON.stringify(background.notifications[0])).not.toContain('sender')
    expect(JSON.stringify(background.notifications[0])).not.toContain('ciphertext')

    const foreground = harness({ visible: true })
    await dispatchPush(foreground, PAYLOAD)
    expect(foreground.notifications).toEqual([])

    const duplicate = harness({ duplicate: true })
    await dispatchPush(duplicate, PAYLOAD)
    expect(duplicate.notifications).toEqual([])
  })

  it('rejects malformed payload and opens the exact conversation on click', async () => {
    const target = harness({ visible: false })
    await dispatchPush(target, { ...PAYLOAD, message_id: 'not-a-uuid' })
    expect(target.notifications).toEqual([])

    let pending = Promise.resolve()
    const event: NotificationClickEventLike = {
      notification: {
        data: { conversationId: PAYLOAD.conversation_id },
        close() {},
      },
      waitUntil(promise) { pending = promise },
    }
    target.listeners.get('notificationclick')?.(event)
    await pending
    expect(target.navigations).toEqual([`/chat?conversation=${PAYLOAD.conversation_id}`])
    expect(target.focused()).toBe(1)
  })
})
