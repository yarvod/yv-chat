import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class ChangePassword {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(currentPassword: string, newPassword: string): Promise<number> {
    return this.gateway.changePassword(currentPassword, newPassword)
  }
}
