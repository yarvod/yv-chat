import { describe, expect, it } from 'vitest'

import { PushNotificationManager } from '../app/application/notifications/push-notification-manager'
import type { BrowserPush } from '../app/application/ports/browser-push'
import type {
  PushConfiguration,
  PushRegistrationGateway,
} from '../app/application/ports/push-registration-gateway'
import type {
  BrowserPushSubscriptionData,
  PushPermissionState,
} from '../app/domain/notifications/push'

const SUBSCRIPTION: BrowserPushSubscriptionData = {
  provider: 'web',
  endpoint: 'https://push.example.test/token',
  p256dh: 'public-key',
  auth: 'auth-secret',
}

class FakeBrowserPush implements BrowserPush {
  readonly provider = 'web' as const
  readonly refreshRegistrationOnInspect = false
  supported = true
  currentPermission: PushPermissionState = 'default'
  subscription: BrowserPushSubscriptionData | null = null
  unsubscribed = 0
  dismissed = false

  isSupported(): boolean { return this.supported }
  async permission(): Promise<PushPermissionState> { return this.currentPermission }
  async requestPermission(): Promise<PushPermissionState> { return this.currentPermission }
  async currentSubscription(): Promise<BrowserPushSubscriptionData | null> {
    return this.subscription
  }

  async subscribe(): Promise<BrowserPushSubscriptionData> {
    this.subscription = SUBSCRIPTION
    return SUBSCRIPTION
  }

  async unsubscribe(): Promise<void> {
    this.subscription = null
    this.unsubscribed += 1
  }

  promptDismissed(): boolean { return this.dismissed }
  dismissPrompt(): void { this.dismissed = true }
  async start(): Promise<() => Promise<void>> { return async () => undefined }
}

class FakeRegistration implements PushRegistrationGateway {
  config: PushConfiguration = {
    enabled: true,
    applicationServerKey: 'application-key',
    providers: ['web'],
  }
  registered = false
  failRegister = false
  registrations: BrowserPushSubscriptionData[] = []
  removals = 0

  async configuration(): Promise<PushConfiguration> { return this.config }
  async registeredProvider(): Promise<'web' | null> { return this.registered ? 'web' : null }
  async register(subscription: BrowserPushSubscriptionData): Promise<void> {
    if (this.failRegister) throw new Error('network')
    this.registrations.push(subscription)
    this.registered = true
  }

  async remove(): Promise<void> {
    this.registered = false
    this.removals += 1
  }
}

describe('PushNotificationManager', () => {
  it('does not ask permission during inspection and exposes unsupported/denied states', async () => {
    const browser = new FakeBrowserPush()
    const registration = new FakeRegistration()
    const manager = new PushNotificationManager(browser, registration)

    browser.supported = false
    expect((await manager.inspect()).status).toBe('unsupported')
    browser.supported = true
    browser.currentPermission = 'denied'
    expect((await manager.inspect()).status).toBe('denied')
    expect(registration.registrations).toEqual([])
  })

  it('subscribes after a granted user gesture and rolls back a new orphan on API failure', async () => {
    const browser = new FakeBrowserPush()
    browser.currentPermission = 'granted'
    const registration = new FakeRegistration()
    registration.failRegister = true
    const manager = new PushNotificationManager(browser, registration)

    expect((await manager.enable()).status).toBe('error')
    expect(browser.unsubscribed).toBe(1)
    expect(browser.subscription).toBeNull()

    registration.failRegister = false
    expect((await manager.enable()).status).toBe('enabled')
    expect(registration.registrations).toEqual([SUBSCRIPTION])
  })

  it('repairs server registration for an existing browser subscription and disables both sides', async () => {
    const browser = new FakeBrowserPush()
    browser.currentPermission = 'granted'
    browser.subscription = SUBSCRIPTION
    const registration = new FakeRegistration()
    const manager = new PushNotificationManager(browser, registration)

    expect((await manager.inspect()).status).toBe('enabled')
    expect(registration.registrations).toEqual([SUBSCRIPTION])
    expect((await manager.disable()).status).toBe('prompt')
    expect(registration.removals).toBe(1)
    expect(browser.unsubscribed).toBe(1)
  })
})
