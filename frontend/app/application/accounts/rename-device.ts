import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class RenameDevice {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(deviceId: string, name: string): Promise<void> {
    return this.gateway.renameDevice(deviceId, name)
  }
}
