import type { BrowserPush } from '../ports/browser-push'
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
    private readonly browser: BrowserPush,
    private readonly registration: PushRegistrationGateway,
  ) {}

  promptDismissed(): boolean {
    return this.browser.promptDismissed()
  }

  dismissPrompt(): void {
    this.browser.dismissPrompt()
  }

  async inspect(): Promise<PushNotificationState> {
    if (!this.browser.isSupported()) return state('unsupported')
    try {
      const configuration = await this.registration.configuration()
      if (!configuration.enabled || !configuration.applicationServerKey) {
        return state('server-disabled')
      }
      const permission = this.browser.permission()
      if (permission === 'denied') return state('denied')
      if (permission === 'default') return state('prompt')
      const [subscription, registered] = await Promise.all([
        this.browser.currentSubscription(),
        this.registration.isRegistered(),
      ])
      if (subscription && !registered) {
        await this.registration.register(subscription)
        return state('enabled')
      }
      return subscription && registered ? state('enabled') : state('prompt')
    } catch {
      return state('error', 'Не удалось проверить настройки уведомлений.')
    }
  }

  async enable(): Promise<PushNotificationState> {
    if (!this.browser.isSupported()) return state('unsupported')
    try {
      // Keep the native permission request inside the original user activation.
      const permission = await this.browser.requestPermission()
      if (permission === 'denied') return state('denied')
      if (permission !== 'granted') return state('prompt')
      const configuration = await this.registration.configuration()
      if (!configuration.enabled || !configuration.applicationServerKey) {
        return state('server-disabled')
      }
      const existing = await this.browser.currentSubscription()
      const subscription = existing ?? await this.browser.subscribe(
        configuration.applicationServerKey,
      )
      try {
        await this.registration.register(subscription)
      } catch (error) {
        if (!existing) await this.browser.unsubscribe()
        throw error
      }
      return state('enabled')
    } catch {
      return state('error', 'Не удалось включить уведомления. Проверьте соединение и повторите.')
    }
  }

  async disable(): Promise<PushNotificationState> {
    if (!this.browser.isSupported()) return state('unsupported')
    try {
      await this.registration.remove()
      await this.browser.unsubscribe()
      return this.browser.permission() === 'denied' ? state('denied') : state('prompt')
    } catch {
      return state('error', 'Не удалось выключить уведомления. Повторите попытку.')
    }
  }
}
