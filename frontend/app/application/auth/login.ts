import type { CurrentAccount } from '../../domain/accounts/account'
import type { AuthGateway } from '../ports/auth-gateway'
import type { DeviceInfoPort } from '../ports/device-info'
import type { HapticsPort } from '../ports/haptics'

export interface LoginCommand {
  username: string
  password: string
}

export class Login {
  constructor(
    private readonly authGateway: AuthGateway,
    private readonly deviceInfo: DeviceInfoPort,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(command: LoginCommand): Promise<CurrentAccount> {
    try {
      const account = await this.authGateway.login({
        username: command.username,
        password: command.password,
        deviceName: this.deviceInfo.current().label,
      })
      this.haptics.perform('success')
      return account
    } catch (error) {
      this.haptics.perform('error')
      throw error
    }
  }
}
