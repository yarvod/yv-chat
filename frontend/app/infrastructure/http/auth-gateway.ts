import type { ActivationGateway, ActivationResult } from '../../application/ports/activation-gateway'
import type { AuthGateway, LoginCredentials } from '../../application/ports/auth-gateway'
import type { CurrentAccount } from '../../domain/accounts/account'
import type { ApiClient } from './api-client'
import { parseActivation, parseCurrentAccount } from './runtime-parsers'

export class HttpAuthGateway implements AuthGateway, ActivationGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async current(): Promise<CurrentAccount> {
    return parseCurrentAccount(await this.apiClient.request('/api/v1/me'))
  }

  async login(credentials: LoginCredentials): Promise<CurrentAccount> {
    await this.apiClient.request('/api/v1/auth/login', {
      method: 'POST',
      body: {
        username: credentials.username,
        password: credentials.password,
        device_name: credentials.deviceName,
      },
    })
    return this.current()
  }

  async logout(): Promise<void> {
    await this.apiClient.request('/api/v1/auth/logout', { method: 'POST' })
  }

  async activate(secret: string, password: string): Promise<ActivationResult> {
    return parseActivation(await this.apiClient.request('/api/v1/auth/activate', {
      method: 'POST',
      body: { activation_secret: secret, password },
    }))
  }
}
