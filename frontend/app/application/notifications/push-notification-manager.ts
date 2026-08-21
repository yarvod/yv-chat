import type { PushNotificationAdapter } from '../ports/browser-push'
import type { PushRegistrationGateway } from '../ports/push-registration-gateway'
import type { PushNotificationState } from '../../domain/notifications/push'

function state(
  status: PushNotificationState['status'],
  message: string | null = null,
): PushNotificationState {
  return { status, busy: false, message }
}

export class PushNotificationManager {
  constructor(
    private readonly adapter: PushNotificationAdapter,
    private readonly registration: PushRegistrationGateway,
  ) {}

  promptDismissed(): boolean {
    return this.adapter.promptDismissed()
  }

  dismissPrompt(): void {
    this.adapter.dismissPrompt()
  }

  async inspect(): Promise<PushNotificationState> {
    if (!this.adapter.isSupported()) return state('unsupported')
    try {
      const configuration = await this.registration.configuration()
      if (!configuration.providers.includes(this.adapter.provider)) {
        return state('server-disabled')
      }
      const permission = await this.adapter.permission()
      if (permission === 'denied') return state('denied')
      if (permission === 'default') return state('prompt')
      const [subscription, registered] = await Promise.all([
        this.adapter.currentSubscription(),
        this.registration.registeredProvider(),
      ])
      if (
        subscription
        && (this.adapter.refreshRegistrationOnInspect || registered !== this.adapter.provider)
      ) {
        await this.registration.register(subscription)
        return state('enabled')
      }
      return subscription && registered === this.adapter.provider ? state('enabled') : state('prompt')
    } catch {
      return state('error', 'Не удалось проверить настройки уведомлений.')
    }
  }

  async enable(): Promise<PushNotificationState> {
    if (!this.adapter.isSupported()) return state('unsupported')
    try {
      // Keep the native permission request inside the original user activation.
      const permission = await this.adapter.requestPermission()
      if (permission === 'denied') return state('denied')
      if (permission !== 'granted') return state('prompt')
      const configuration = await this.registration.configuration()
      if (!configuration.providers.includes(this.adapter.provider)) {
        return state('server-disabled')
      }
      const existing = await this.adapter.currentSubscription()
      const subscription = existing ?? await this.adapter.subscribe(configuration.applicationServerKey)
      try {
        await this.registration.register(subscription)
      } catch (error) {
        if (!existing) await this.adapter.unsubscribe()
        throw error
      }
      return state('enabled')
    } catch {
      return state('error', 'Не удалось включить уведомления. Проверьте соединение и повторите.')
    }
  }

  async disable(): Promise<PushNotificationState> {
    if (!this.adapter.isSupported()) return state('unsupported')
    try {
      await this.registration.remove()
      await this.adapter.unsubscribe()
      return await this.adapter.permission() === 'denied' ? state('denied') : state('prompt')
    } catch {
      return state('error', 'Не удалось выключить уведомления. Повторите попытку.')
    }
  }
}
