import type { CurrentAccount } from '../../domain/accounts/account'
import type { DeviceInfoPort } from '../ports/device-info'
import type { HapticsPort } from '../ports/haptics'
import type { RegistrationGateway } from '../ports/registration-gateway'

export interface RegisterAccountCommand {
  activationSecret: string
  username: string
  displayName: string
  password: string
}

export class RegisterAccount {
  constructor(
    private readonly gateway: RegistrationGateway,
    private readonly deviceInfo: DeviceInfoPort,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(command: RegisterAccountCommand): Promise<CurrentAccount> {
    try {
      await this.gateway.register({
        ...command,
        deviceName: this.deviceInfo.current().label,
      })
      const account = await this.gateway.current()
      this.haptics.perform('success')
      return account
    } catch (error) {
      this.haptics.perform('error')
      throw error
    }
  }
}
