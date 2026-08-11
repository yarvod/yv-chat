import type { Invitation } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'
import type { HapticsPort } from '../ports/haptics'

export class InviteUser {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(username: string, displayName: string): Promise<Invitation> {
    const result = await this.gateway.invite(username, displayName)
    this.haptics.perform('success')
    return result
  }
}
