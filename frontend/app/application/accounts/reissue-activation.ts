import type { ActivationReissue } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'
import type { HapticsPort } from '../ports/haptics'

export class ReissueActivation {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(userId: string): Promise<ActivationReissue> {
    const result = await this.gateway.reissueActivation(userId)
    this.haptics.perform('success')
    return result
  }
}
