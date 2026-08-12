import type { BrowserPushSubscriptionData } from '../../domain/notifications/push'

export interface PushConfiguration {
  enabled: boolean
  applicationServerKey: string | null
}

export interface PushRegistrationGateway {
  configuration(): Promise<PushConfiguration>
  isRegistered(): Promise<boolean>
  register(subscription: BrowserPushSubscriptionData): Promise<void>
  remove(): Promise<void>
}
