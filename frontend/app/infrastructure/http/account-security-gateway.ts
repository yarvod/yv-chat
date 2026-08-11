import type { AccountSecurityGateway } from '../../application/ports/account-security-gateway'
import type { CurrentAccount } from '../../domain/accounts/account'
import type { DeviceSession, SecurityEvent } from '../../domain/accounts/security'
import {
  parseChangedPasswordCount,
  parseDeviceSessions,
  parseRevokedCount,
  parseSecurityEvents,
} from './account-security-parsers'
import type { ApiClient } from './api-client'
import { parseCurrentAccount } from './runtime-parsers'

export class HttpAccountSecurityGateway implements AccountSecurityGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async updateProfile(displayName: string): Promise<CurrentAccount> {
    return parseCurrentAccount(await this.apiClient.request('/api/v1/me', {
      method: 'PATCH', body: { display_name: displayName },
    }))
  }

  async listDevices(): Promise<DeviceSession[]> {
    return parseDeviceSessions(await this.apiClient.request('/api/v1/devices'))
  }

  async renameDevice(deviceId: string, name: string): Promise<void> {
    await this.apiClient.request(`/api/v1/devices/${deviceId}`, {
      method: 'PATCH', body: { name },
    })
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.apiClient.request(`/api/v1/devices/${deviceId}`, { method: 'DELETE' })
  }

  async revokeOtherSessions(): Promise<number> {
    return parseRevokedCount(await this.apiClient.request('/api/v1/sessions/revoke-others', {
      method: 'POST',
    }))
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<number> {
    return parseChangedPasswordCount(await this.apiClient.request('/api/v1/me/password', {
      method: 'PATCH', body: { current_password: currentPassword, new_password: newPassword },
    }))
  }

  async securityReset(currentPassword: string): Promise<void> {
    await this.apiClient.request('/api/v1/me/security-reset', {
      method: 'POST', body: { current_password: currentPassword },
    })
  }

  async listSecurityEvents(limit: number): Promise<SecurityEvent[]> {
    return parseSecurityEvents(
      await this.apiClient.request(`/api/v1/security-events?limit=${limit}`),
    )
  }
}
