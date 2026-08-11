import type { ManagedUser } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'

export class ListManagedUsers {
  constructor(private readonly gateway: AdminAccountsGateway) {}

  execute(): Promise<ManagedUser[]> {
    return this.gateway.list()
  }
}
