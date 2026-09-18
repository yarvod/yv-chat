import type { PushNotificationAdapter } from '../../application/ports/browser-push'
import type { DeliveredMessageNotification, DeliveredNotifications } from '../../application/ports/delivered-notifications'
import type {
  BrowserPushSubscriptionData,
  PushPermissionState,
} from '../../domain/notifications/push'

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const decoded = atob(padded)
  const result = new Uint8Array(new ArrayBuffer(decoded.length))
  for (let index = 0; index < decoded.length; index += 1) {
    result[index] = decoded.charCodeAt(index)
  }
  if (result.byteLength !== 65 || result[0] !== 4) {
    throw new Error('invalid VAPID public key')
  }
  return result
}

function serialize(subscription: PushSubscription): BrowserPushSubscriptionData {
  const p256dh = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')
  if (!p256dh || !auth) throw new Error('push subscription keys are unavailable')
  return {
    provider: 'web',
    endpoint: subscription.endpoint,
    p256dh: base64Url(new Uint8Array(p256dh)),
    auth: base64Url(new Uint8Array(auth)),
  }
}

const notificationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function messageNotification(notification: Notification): DeliveredMessageNotification | null {
  const data: unknown = notification.data
  if (!notification.tag.startsWith('yv-message-') || typeof data !== 'object' || data === null) return null
  const { conversationId, messageId } = data as Record<string, unknown>
  if (typeof conversationId !== 'string' || !notificationUuid.test(conversationId)
    || typeof messageId !== 'string' || !notificationUuid.test(messageId)) return null
  return { id: notification.tag, conversationId, messageId }
}

export class BrowserPushAdapter implements PushNotificationAdapter, DeliveredNotifications {
  readonly provider = 'web' as const
  readonly refreshRegistrationOnInspect = false

  isSupported(): boolean {
    return typeof window !== 'undefined'
      && 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window
  }

  async permission(): Promise<PushPermissionState> {
    return this.isSupported() ? Notification.permission : 'default'
  }

  async requestPermission(): Promise<PushPermissionState> {
    if (!this.isSupported()) return 'default'
    return await Notification.requestPermission()
  }

  async currentSubscription(): Promise<BrowserPushSubscriptionData | null> {
    if (!this.isSupported()) return null
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? serialize(subscription) : null
  }

  async subscribe(applicationServerKey: string | null): Promise<BrowserPushSubscriptionData> {
    if (!this.isSupported()) throw new Error('Web Push is unsupported')
    if (!applicationServerKey) throw new Error('VAPID public key is unavailable')
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(applicationServerKey),
    })
    return serialize(subscription)
  }

  async unsubscribe(): Promise<void> {
    if (!this.isSupported()) return
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) await subscription.unsubscribe()
  }

  promptDismissed(): boolean {
    return localStorage.getItem('yv-push-prompt-dismissed-v1') === '1'
  }

  dismissPrompt(): void {
    localStorage.setItem('yv-push-prompt-dismissed-v1', '1')
  }

  async start(): Promise<() => Promise<void>> {
    return async () => undefined
  }

  async listMessages(): Promise<DeliveredMessageNotification[]> {
    const notifications = await this.delivered()
    return notifications.flatMap(notification => {
      const message = messageNotification(notification)
      return message ? [message] : []
    })
  }

  async dismissMessages(messages: readonly DeliveredMessageNotification[]): Promise<void> {
    for (const notification of await this.delivered()) {
      const current = messageNotification(notification)
      if (current && messages.some(message => message.id === current.id
        && message.conversationId === current.conversationId
        && message.messageId === current.messageId)) notification.close()
    }
  }

  private async delivered(): Promise<Notification[]> {
    if (!this.isSupported()) return []
    // Unlike ready, getRegistration also settles when no worker is installed.
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.getNotifications ? registration.getNotifications() : []
  }
}
