import type { CurrentAccount } from '../../domain/accounts/account'
import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class UpdateProfile {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(displayName: string): Promise<CurrentAccount> {
    return this.gateway.updateProfile(displayName)
  }
}
