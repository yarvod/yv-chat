import type { ManagedUsersPage } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'

export class ListManagedUsers {
  constructor(private readonly gateway: AdminAccountsGateway) {}

  execute(search: string | null = null, limit = 20, offset = 0): Promise<ManagedUsersPage> {
    return this.gateway.list(search, limit, offset)
  }
}
