import type { DeviceSession } from '../../domain/accounts/security'
import type { AccountSecurityGateway } from '../ports/account-security-gateway'

export class ListDeviceSessions {
  constructor(private readonly gateway: AccountSecurityGateway) {}

  execute(): Promise<DeviceSession[]> {
    return this.gateway.listDevices()
  }
}
