import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class RevokeOtherSessions {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(): Promise<number> {
    return this.gateway.revokeOtherSessions()
  }
}
