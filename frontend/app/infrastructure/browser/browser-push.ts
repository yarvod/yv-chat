import type { BrowserPush } from '../../application/ports/browser-push'
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
    endpoint: subscription.endpoint,
    p256dh: base64Url(new Uint8Array(p256dh)),
    auth: base64Url(new Uint8Array(auth)),
  }
}

export class BrowserPushAdapter implements BrowserPush {
  isSupported(): boolean {
    return typeof window !== 'undefined'
      && 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window
  }

  permission(): PushPermissionState {
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

  async subscribe(applicationServerKey: string): Promise<BrowserPushSubscriptionData> {
    if (!this.isSupported()) throw new Error('Web Push is unsupported')
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
}
