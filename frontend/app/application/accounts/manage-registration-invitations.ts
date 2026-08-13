import type {
  CreatedRegistrationInvitation,
  RegistrationInvitationsPage,
} from '../../domain/accounts/registration-invitation'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'
import type { HapticsPort } from '../ports/haptics'

export class ListRegistrationInvitations {
  constructor(private readonly gateway: AdminAccountsGateway) {}

  execute(limit: number, offset: number): Promise<RegistrationInvitationsPage> {
    return this.gateway.listInvitations(limit, offset)
  }
}

export class CreateRegistrationInvitation {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(label: string | null): Promise<CreatedRegistrationInvitation> {
    const result = await this.gateway.createInvitation(label)
    this.haptics.perform('success')
    return result
  }
}

export class RevokeRegistrationInvitation {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(invitationId: string): Promise<void> {
    await this.gateway.revokeInvitation(invitationId)
    this.haptics.perform('selection')
  }
}
