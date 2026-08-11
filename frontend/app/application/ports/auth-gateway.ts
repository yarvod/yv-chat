import type { CurrentAccount } from '../../domain/accounts/account'

export interface LoginCredentials {
  username: string
  password: string
  deviceName: string
}

export interface AuthGateway {
  current(): Promise<CurrentAccount>
  login(credentials: LoginCredentials): Promise<CurrentAccount>
  logout(): Promise<void>
}
