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
    data: { conversationId?: string, messageId?: string }
    close(): void
  }
}

type EventHandler = (event: unknown) => void

class FakeMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  peer: FakeMessagePort | null = null

  postMessage(value: unknown): void {
    this.peer?.onmessage?.({ data: value })
  }

  close(): void {}
}

class FakeMessageChannel {
  readonly port1 = new FakeMessagePort()
  readonly port2 = new FakeMessagePort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function harness(options: {
  visible?: boolean
  duplicate?: boolean
  staleClient?: boolean
  acknowledgeNavigation?: boolean
} = {}) {
  const listeners = new Map<string, EventHandler>()
  const notifications: { title: string, options: Record<string, unknown> }[] = []
  const navigations: string[] = []
  const actions: string[] = []
  const messages: unknown[] = []
  let focused = 0
  const windowClient = {
    visibilityState: options.visible ? 'visible' : 'hidden',
    focused: false,
    async navigate(url: string): Promise<typeof windowClient> {
      actions.push('navigate')
      navigations.push(url)
      return windowClient
    },
    async focus(): Promise<typeof windowClient> {
      actions.push('focus')
      focused += 1
      if (options.staleClient) throw new Error('discarded task')
      return windowClient
    },
    postMessage(value: unknown, transfer: FakeMessagePort[] = []): void {
      actions.push('postMessage')
      messages.push(value)
      if (options.acknowledgeNavigation !== false) {
        transfer[0]?.postMessage({ type: 'yv-notification-navigation-ack' })
      }
    },
  }
  const worker = {
    addEventListener(type: string, listener: EventHandler): void { listeners.set(type, listener) },
    clients: {
      async matchAll(): Promise<typeof windowClient[]> { return options.visible === undefined ? [] : [windowClient] },
      async openWindow(url: string): Promise<typeof windowClient> {
        actions.push('openWindow')
        navigations.push(url)
        return windowClient
      },
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
    {
      self: worker,
      MessageChannel: FakeMessageChannel,
      setTimeout: (callback: () => void) => setTimeout(callback, 0),
      clearTimeout,
    },
  )
  return {
    listeners,
    notifications,
    navigations,
    actions,
    messages,
    focused: () => focused,
  }
}

const PAYLOAD = {
  version: 1,
  event_type: 'message_created',
  event_id: '12d9b642-165a-45f0-bceb-d09778f88ff7',
  conversation_id: 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e',
  message_id: '7befbd28-1b77-48ee-8b6c-6f279fc1b92e',
  sync_required: true,
}

const CALL_PAYLOAD = {
  version: 1,
  event_type: 'incoming_call',
  event_id: '58e81609-a352-4bb0-8c2e-5de4ecf38876',
  conversation_id: 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e',
  message_id: null,
  call_id: '60cf6877-9dd1-454e-86ac-f42303c7775a',
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
  it('shows an opaque incoming-call wake-up without signaling data', async () => {
    const target = harness()
    await dispatchPush(target, CALL_PAYLOAD)
    expect(target.notifications[0]?.title).toBe('Входящий звонок')
    expect(target.notifications[0]?.options.vibrate).toEqual([280, 140, 280, 140, 420])
    expect(target.notifications[0]?.options.actions).toEqual([{
      action: 'open', title: 'Открыть звонок',
    }])
    expect(JSON.stringify(target.notifications[0])).not.toContain('sdp')
    expect(JSON.stringify(target.notifications[0])).not.toContain('candidate')
  })
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

  it('routes a notification through a live app without tearing down its call state', async () => {
    const target = harness({ visible: false })
    await dispatchPush(target, { ...PAYLOAD, message_id: 'not-a-uuid' })
    expect(target.notifications).toEqual([])

    let pending = Promise.resolve()
    const event: NotificationClickEventLike = {
      notification: {
        data: {
          conversationId: PAYLOAD.conversation_id,
          messageId: PAYLOAD.message_id,
        },
        close() {},
      },
      waitUntil(promise) { pending = promise },
    }
    target.listeners.get('notificationclick')?.(event)
    await pending
    expect(target.navigations).toEqual([])
    expect(target.focused()).toBe(1)
    expect(target.actions).toEqual(['focus', 'postMessage'])
    expect(target.messages).toEqual([{
      type: 'yv-notification-navigation',
      conversationId: PAYLOAD.conversation_id,
      messageId: PAYLOAD.message_id,
    }])
  })

  it('falls back to exact hard navigation when a focused client does not acknowledge', async () => {
    const target = harness({ visible: false, acknowledgeNavigation: false })
    let pending = Promise.resolve()
    const event: NotificationClickEventLike = {
      notification: {
        data: {
          conversationId: PAYLOAD.conversation_id,
          messageId: PAYLOAD.message_id,
        },
        close() {},
      },
      waitUntil(promise) { pending = promise },
    }
    target.listeners.get('notificationclick')?.(event)
    await pending
    expect(target.navigations).toEqual([
      `/chat?conversation=${PAYLOAD.conversation_id}&message=${PAYLOAD.message_id}`,
    ])
    expect(target.actions).toEqual(['focus', 'postMessage', 'navigate'])
  })

  it('opens and focuses a fresh window when Android reports a discarded task', async () => {
    const target = harness({ visible: false, staleClient: true })
    let pending = Promise.resolve()
    const event: NotificationClickEventLike = {
      notification: {
        data: {
          conversationId: PAYLOAD.conversation_id,
          messageId: PAYLOAD.message_id,
        },
        close() {},
      },
      waitUntil(promise) { pending = promise },
    }
    target.listeners.get('notificationclick')?.(event)
    await pending
    expect(target.navigations).toEqual([
      `/chat?conversation=${PAYLOAD.conversation_id}&message=${PAYLOAD.message_id}`,
    ])
    expect(target.actions).toEqual(['focus', 'openWindow', 'focus'])
  })
})
