import type { PermissionState, PluginListenerHandle } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

import type { PushNotificationAdapter } from '../../application/ports/browser-push'
import type {
  NativePushSubscriptionData,
  PushNavigationTarget,
  PushPermissionState,
} from '../../domain/notifications/push'

interface NativePermissionStatus { receive: PermissionState }
interface NativeToken { value: string }
interface NativeRegistrationError { error: string }
interface NativeNotification { data: unknown }
interface NativeAction { notification: NativeNotification }

export interface NativePushPlugin {
  checkPermissions(): Promise<NativePermissionStatus>
  requestPermissions(): Promise<NativePermissionStatus>
  register(): Promise<void>
  unregister(): Promise<void>
  createChannel(channel: {
    id: string
    name: string
    description: string
    importance: 3 | 4
    visibility: 0
    vibration: boolean
  }): Promise<void>
  addListener(
    eventName: 'registration',
    listener: (token: NativeToken) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'registrationError',
    listener: (error: NativeRegistrationError) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'pushNotificationActionPerformed',
    listener: (action: NativeAction) => void,
  ): Promise<PluginListenerHandle>
}

function permission(value: PermissionState): PushPermissionState {
  if (value === 'granted') return 'granted'
  if (value === 'denied') return 'denied'
  return 'default'
}

function validToken(provider: 'apns' | 'fcm', value: string): boolean {
  if (provider === 'apns') return /^[0-9a-f]{64}$/iu.test(value)
  return value.length >= 32 && value.length <= 4096 && !/\s/u.test(value)
}

const pushUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function nativePushNavigationTarget(value: unknown): PushNavigationTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const eventType = candidate.event_type
  const eventId = candidate.event_id
  const conversationId = candidate.conversation_id
  const messageId = candidate.message_id
  const callId = candidate.call_id
  if (
    !(candidate.version === 1 || candidate.version === '1')
    || !(candidate.sync_required === true || candidate.sync_required === 'true')
    || !['message_created', 'incoming_call'].includes(String(eventType))
    || typeof eventId !== 'string'
    || !pushUuid.test(eventId)
    || typeof conversationId !== 'string'
    || !pushUuid.test(conversationId)
    || (eventType === 'message_created'
      && (typeof messageId !== 'string' || !pushUuid.test(messageId)))
    || (eventType === 'incoming_call'
      && (typeof callId !== 'string' || !pushUuid.test(callId)))
  ) return null
  return {
    conversationId,
    ...(eventType === 'message_created' && typeof messageId === 'string' ? { messageId } : {}),
  }
}

export class CapacitorPushAdapter implements PushNotificationAdapter {
  readonly refreshRegistrationOnInspect = true

  constructor(
    readonly provider: 'apns' | 'fcm',
    private readonly plugin: NativePushPlugin = PushNotifications,
  ) {}

  isSupported(): boolean {
    return true
  }

  async permission(): Promise<PushPermissionState> {
    return permission((await this.plugin.checkPermissions()).receive)
  }

  async requestPermission(): Promise<PushPermissionState> {
    return permission((await this.plugin.requestPermissions()).receive)
  }

  async currentSubscription(): Promise<NativePushSubscriptionData | null> {
    if (await this.permission() !== 'granted') return null
    return await this.registrationToken()
  }

  async subscribe(): Promise<NativePushSubscriptionData> {
    return await this.registrationToken()
  }

  async unsubscribe(): Promise<void> {
    await this.plugin.unregister()
  }

  promptDismissed(): boolean {
    return localStorage.getItem(`yv-push-prompt-dismissed-v1-${this.provider}`) === '1'
  }

  dismissPrompt(): void {
    localStorage.setItem(`yv-push-prompt-dismissed-v1-${this.provider}`, '1')
  }

  async start(
    onNavigate: (target: PushNavigationTarget) => void,
  ): Promise<() => Promise<void>> {
    if (this.provider === 'fcm') {
      await Promise.all([
        this.plugin.createChannel({
          id: 'yv_messages',
          name: 'Сообщения',
          description: 'Новые зашифрованные сообщения',
          importance: 3,
          visibility: 0,
          vibration: true,
        }),
        this.plugin.createChannel({
          id: 'yv_calls',
          name: 'Звонки',
          description: 'Входящие звонки',
          importance: 4,
          visibility: 0,
          vibration: true,
        }),
      ])
    }
    const handle = await this.plugin.addListener('pushNotificationActionPerformed', action => {
      const target = nativePushNavigationTarget(action.notification.data)
      if (target) onNavigate(target)
    })
    return async () => handle.remove()
  }

  private async registrationToken(): Promise<NativePushSubscriptionData> {
    let complete: ((token: NativePushSubscriptionData) => void) | null = null
    let fail: ((error: Error) => void) | null = null
    const result = new Promise<NativePushSubscriptionData>((resolve, reject) => {
      complete = resolve
      fail = reject
    })
    const registration = await this.plugin.addListener('registration', token => {
      if (!validToken(this.provider, token.value)) {
        fail?.(new Error('native push token is invalid'))
        return
      }
      complete?.({ provider: this.provider, token: token.value })
    })
    const registrationError = await this.plugin.addListener('registrationError', error => {
      fail?.(new Error(error.error || 'native push registration failed'))
    })
    const timeout = globalThis.setTimeout(() => {
      fail?.(new Error('native push registration timed out'))
    }, 15_000)
    try {
      await this.plugin.register()
      return await result
    } finally {
      globalThis.clearTimeout(timeout)
      await Promise.all([registration.remove(), registrationError.remove()])
    }
  }
}
