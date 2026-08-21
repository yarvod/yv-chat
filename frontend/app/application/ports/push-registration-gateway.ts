import type {
  PushProvider,
  PushSubscriptionData,
} from '../../domain/notifications/push'

export interface PushConfiguration {
  enabled: boolean
  applicationServerKey: string | null
  providers: PushProvider[]
}

export interface PushRegistrationGateway {
  configuration(): Promise<PushConfiguration>
  registeredProvider(): Promise<PushProvider | null>
  register(subscription: PushSubscriptionData): Promise<void>
  remove(): Promise<void>
}
