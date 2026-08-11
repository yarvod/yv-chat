import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class SecurityReset {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(currentPassword: string): Promise<void> {
    return this.gateway.securityReset(currentPassword)
  }
}
