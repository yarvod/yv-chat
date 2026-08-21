import type {
  PushConfiguration,
  PushRegistrationGateway,
} from '../../application/ports/push-registration-gateway'
import type {
  PushProvider,
  PushSubscriptionData,
} from '../../domain/notifications/push'
import type { ApiClient } from './api-client'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid push API response')
  }
  return value as Record<string, unknown>
}

export class HttpPushRegistrationGateway implements PushRegistrationGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async configuration(): Promise<PushConfiguration> {
    const value = record(await this.apiClient.request('/api/v1/push/config'))
    const rawProviders = value.providers
    const providers = Array.isArray(rawProviders)
      && rawProviders.every(provider => ['web', 'apns', 'fcm'].includes(String(provider)))
      ? rawProviders as PushProvider[]
      : value.enabled === true ? ['web'] satisfies PushProvider[] : []
    if (
      typeof value.enabled !== 'boolean'
      || !(typeof value.application_server_key === 'string'
        || value.application_server_key === null)
    ) {
      throw new Error('invalid push configuration')
    }
    return {
      enabled: value.enabled,
      applicationServerKey: value.application_server_key,
      providers,
    }
  }

  async registeredProvider(): Promise<PushProvider | null> {
    const value = record(await this.apiClient.request('/api/v1/push/subscription'))
    if (typeof value.registered !== 'boolean') throw new Error('invalid push status')
    const provider = value.provider
    if (!value.registered) return null
    if (!['web', 'apns', 'fcm'].includes(String(provider))) {
      // Compatibility with the pre-provider API means a registered row was Web Push.
      return provider === undefined ? 'web' : null
    }
    return provider as PushProvider
  }

  async register(subscription: PushSubscriptionData): Promise<void> {
    await this.apiClient.request('/api/v1/push/subscription', {
      method: 'PUT',
      body: subscription.provider === 'web'
        ? {
            provider: 'web',
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }
        : { provider: subscription.provider, token: subscription.token },
    })
  }

  async remove(): Promise<void> {
    await this.apiClient.request('/api/v1/push/subscription', { method: 'DELETE' })
  }
}
