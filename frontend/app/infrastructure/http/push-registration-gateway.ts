import type {
  PushConfiguration,
  PushRegistrationGateway,
} from '../../application/ports/push-registration-gateway'
import type { BrowserPushSubscriptionData } from '../../domain/notifications/push'
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
    }
  }

  async isRegistered(): Promise<boolean> {
    const value = record(await this.apiClient.request('/api/v1/push/subscription'))
    if (typeof value.registered !== 'boolean') throw new Error('invalid push status')
    return value.registered
  }

  async register(subscription: BrowserPushSubscriptionData): Promise<void> {
    await this.apiClient.request('/api/v1/push/subscription', {
      method: 'PUT',
      body: {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
    })
  }

  async remove(): Promise<void> {
    await this.apiClient.request('/api/v1/push/subscription', { method: 'DELETE' })
  }
}
