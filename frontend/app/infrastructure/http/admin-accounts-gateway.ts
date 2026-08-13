import type { AdminAccountsGateway } from '../../application/ports/admin-accounts-gateway'
import type {
  ActivationReissue,
  Invitation,
  ManagedUsersPage,
  ManagedUserUpdate,
  PasswordResetIssue,
} from '../../domain/accounts/managed-user'
import type {
  CreatedRegistrationInvitation,
  RegistrationInvitationsPage,
} from '../../domain/accounts/registration-invitation'
import type { ApiClient } from './api-client'
import {
  parseActivationReissue,
  parseInvitation,
  parseManagedUsers,
  parseManagedUserUpdate,
  parsePasswordResetIssue,
  parseCreatedRegistrationInvitation,
  parseRegistrationInvitations,
} from './admin-accounts-parsers'

export class HttpAdminAccountsGateway implements AdminAccountsGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async list(search: string | null, limit: number, offset: number): Promise<ManagedUsersPage> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (search) query.set('search', search)
    return parseManagedUsers(
      await this.apiClient.request(`/api/v1/admin/users?${query.toString()}`),
    )
  }

  async invite(username: string, displayName: string): Promise<Invitation> {
    return parseInvitation(await this.apiClient.request('/api/v1/admin/users', {
      method: 'POST',
      body: { username, display_name: displayName },
    }))
  }

  async setActive(userId: string, isActive: boolean): Promise<ManagedUserUpdate> {
    return parseManagedUserUpdate(await this.apiClient.request(`/api/v1/admin/users/${userId}`, {
      method: 'PATCH',
      body: { is_active: isActive },
    }))
  }

  async reissueActivation(userId: string): Promise<ActivationReissue> {
    return parseActivationReissue(await this.apiClient.request(
      `/api/v1/admin/users/${userId}/activation-secret`,
      { method: 'POST' },
    ))
  }

  async issuePasswordReset(userId: string): Promise<PasswordResetIssue> {
    return parsePasswordResetIssue(await this.apiClient.request(
      `/api/v1/admin/users/${userId}/password-reset`,
      { method: 'POST' },
    ))
  }

  async listInvitations(limit: number, offset: number): Promise<RegistrationInvitationsPage> {
    return parseRegistrationInvitations(await this.apiClient.request(
      `/api/v1/admin/invitations?limit=${limit}&offset=${offset}`,
    ))
  }

  async createInvitation(label: string | null): Promise<CreatedRegistrationInvitation> {
    return parseCreatedRegistrationInvitation(await this.apiClient.request(
      '/api/v1/admin/invitations',
      { method: 'POST', body: { label } },
    ))
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await this.apiClient.request(
      `/api/v1/admin/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: 'POST' },
    )
  }
}
