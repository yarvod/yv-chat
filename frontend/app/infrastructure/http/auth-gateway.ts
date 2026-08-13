import type { ActivationGateway, ActivationResult } from '../../application/ports/activation-gateway'
import type { AuthGateway, LoginCredentials } from '../../application/ports/auth-gateway'
import type {
  RegistrationCommand,
  RegistrationGateway,
} from '../../application/ports/registration-gateway'
import type {
  PasswordRecoveryGateway,
  PasswordResetResult,
} from '../../application/ports/password-recovery-gateway'
import type { CurrentAccount } from '../../domain/accounts/account'
import type { ApiClient } from './api-client'
import { parseActivation, parseCurrentAccount, parsePasswordReset } from './runtime-parsers'

export class HttpAuthGateway implements AuthGateway, ActivationGateway, PasswordRecoveryGateway,
  RegistrationGateway {
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

  async register(command: RegistrationCommand): Promise<void> {
    await this.apiClient.request('/api/v1/auth/register', {
      method: 'POST',
      body: {
        activation_secret: command.activationSecret,
        username: command.username,
        display_name: command.displayName,
        password: command.password,
        device_name: command.deviceName,
      },
    })
  }

  async activate(secret: string, password: string): Promise<ActivationResult> {
    return parseActivation(await this.apiClient.request('/api/v1/auth/activate', {
      method: 'POST',
      body: { activation_secret: secret, password },
    }))
  }

  async resetPassword(secret: string, newPassword: string): Promise<PasswordResetResult> {
    return parsePasswordReset(await this.apiClient.request('/api/v1/auth/reset-password', {
      method: 'POST',
      body: { reset_secret: secret, new_password: newPassword },
    }))
  }
}
