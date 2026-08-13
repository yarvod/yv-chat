import type { CurrentAccount } from '../../domain/accounts/account'

export interface RegistrationCommand {
  activationSecret: string
  username: string
  displayName: string
  password: string
  deviceName: string
}

export interface RegistrationGateway {
  register(command: RegistrationCommand): Promise<void>
  current(): Promise<CurrentAccount>
}
