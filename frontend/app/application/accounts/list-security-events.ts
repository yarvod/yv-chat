import type { SecurityEvent } from '../../domain/accounts/security'
import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class ListSecurityEvents {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(limit = 20): Promise<SecurityEvent[]> {
    return this.gateway.listSecurityEvents(limit)
  }
}
