import type { PermissionState, PluginListenerHandle } from '@capacitor/core'
import { describe, expect, it } from 'vitest'

import {
  CapacitorPushAdapter,
  nativePushNavigationTarget,
  type NativePushPlugin,
} from '../app/infrastructure/capacitor/capacitor-push'

type RegistrationListener = (token: { value: string }) => void
type ErrorListener = (error: { error: string }) => void
type ActionListener = (action: { notification: { data: unknown } }) => void

class FakeNativePush implements NativePushPlugin {
  permission: PermissionState = 'granted'
  token = `fcm:${'t'.repeat(64)}`
  registrations = 0
  unregistrations = 0
  channels: string[] = []
  registrationListener: RegistrationListener | null = null
  errorListener: ErrorListener | null = null
  actionListener: ActionListener | null = null

  async checkPermissions(): Promise<{ receive: PermissionState }> {
    return { receive: this.permission }
  }

  async requestPermissions(): Promise<{ receive: PermissionState }> {
    return { receive: this.permission }
  }

  async register(): Promise<void> {
    this.registrations += 1
    this.registrationListener?.({ value: this.token })
  }

  async unregister(): Promise<void> {
    this.unregistrations += 1
  }

  async createChannel(channel: { id: string }): Promise<void> {
    this.channels.push(channel.id)
  }

  addListener(
    eventName: 'registration',
    listener: RegistrationListener,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'registrationError',
    listener: ErrorListener,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'pushNotificationActionPerformed',
    listener: ActionListener,
  ): Promise<PluginListenerHandle>
  async addListener(eventName: string, listener: unknown): Promise<PluginListenerHandle> {
    if (eventName === 'registration') this.registrationListener = listener as RegistrationListener
    if (eventName === 'registrationError') this.errorListener = listener as ErrorListener
    if (eventName === 'pushNotificationActionPerformed') {
      this.actionListener = listener as ActionListener
    }
    return { remove: async () => undefined }
  }
}

describe('CapacitorPushAdapter', () => {
  it('asks the OS for a fresh FCM token instead of caching it in web storage', async () => {
    const plugin = new FakeNativePush()
    const adapter = new CapacitorPushAdapter('fcm', plugin)

    expect(await adapter.currentSubscription()).toEqual({ provider: 'fcm', token: plugin.token })
    plugin.token = `fcm:${'n'.repeat(64)}`
    expect(await adapter.currentSubscription()).toEqual({ provider: 'fcm', token: plugin.token })
    expect(plugin.registrations).toBe(2)
    expect(localStorage.getItem('yv-native-push-token')).toBeNull()

    await adapter.unsubscribe()
    expect(plugin.unregistrations).toBe(1)
  })

  it('creates private Android channels and accepts only validated opaque tap data', async () => {
    const plugin = new FakeNativePush()
    const adapter = new CapacitorPushAdapter('fcm', plugin)
    const navigations: object[] = []
    const stop = await adapter.start(target => navigations.push(target))
    const conversationId = 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e'
    const messageId = '7befbd28-1b77-48ee-8b6c-6f279fc1b92e'

    plugin.actionListener?.({
      notification: {
        data: {
          version: '1',
          event_type: 'message_created',
          event_id: '27703450-06b2-4df5-b764-4fe7e236f55f',
          conversation_id: conversationId,
          message_id: messageId,
          sync_required: 'true',
        },
      },
    })
    plugin.actionListener?.({ notification: { data: { conversation_id: conversationId } } })

    expect(plugin.channels).toEqual(['yv_messages', 'yv_calls'])
    expect(navigations).toEqual([{ conversationId, messageId }])
    await stop()
  })

  it('parses generic incoming calls without inventing a message target', () => {
    const conversationId = 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e'
    expect(nativePushNavigationTarget({
      version: 1,
      event_type: 'incoming_call',
      event_id: '27703450-06b2-4df5-b764-4fe7e236f55f',
      conversation_id: conversationId,
      call_id: '7befbd28-1b77-48ee-8b6c-6f279fc1b92e',
      sync_required: true,
    })).toEqual({ conversationId })
  })
})
