import type { AdminAccountsGateway } from '../../application/ports/admin-accounts-gateway'
import type { Invitation, ManagedUser } from '../../domain/accounts/managed-user'
import type { ApiClient } from './api-client'
import { parseInvitation, parseManagedUsers } from './admin-accounts-parsers'

export class HttpAdminAccountsGateway implements AdminAccountsGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async list(): Promise<ManagedUser[]> {
    return parseManagedUsers(await this.apiClient.request('/api/v1/admin/users'))
  }

  async invite(username: string, displayName: string): Promise<Invitation> {
    return parseInvitation(await this.apiClient.request('/api/v1/admin/users', {
      method: 'POST',
      body: { username, display_name: displayName },
    }))
  }
}
