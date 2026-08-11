import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class RevokeDevice {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(deviceId: string): Promise<void> {
    return this.gateway.revokeDevice(deviceId)
  }
}
