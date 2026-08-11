import type { ManagedUserUpdate } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'
import type { HapticsPort } from '../ports/haptics'

export class SetManagedUserActive {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(userId: string, isActive: boolean): Promise<ManagedUserUpdate> {
    const result = await this.gateway.setActive(userId, isActive)
    this.haptics.perform(isActive ? 'success' : 'warning')
    return result
  }
}
