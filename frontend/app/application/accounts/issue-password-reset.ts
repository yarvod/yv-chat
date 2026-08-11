import type { PasswordResetIssue } from '../../domain/accounts/managed-user'
import type { AdminAccountsGateway } from '../ports/admin-accounts-gateway'
import type { HapticsPort } from '../ports/haptics'

export class IssuePasswordReset {
  constructor(
    private readonly gateway: AdminAccountsGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(userId: string): Promise<PasswordResetIssue> {
    const result = await this.gateway.issuePasswordReset(userId)
    this.haptics.perform('warning')
    return result
  }
}
