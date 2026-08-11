import type { Invitation, ManagedUser } from '../../domain/accounts/managed-user'

export interface AdminAccountsGateway {
  list(): Promise<ManagedUser[]>
  invite(username: string, displayName: string): Promise<Invitation>
}
