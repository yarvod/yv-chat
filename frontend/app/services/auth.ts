import { apiRequest } from './api'
import { parseCurrentAccount, type CurrentAccount } from './parsers'

export interface LoginInput {
  username: string
  password: string
  deviceName: string
}

export const authService = {
  async current(): Promise<CurrentAccount> {
    return parseCurrentAccount(await apiRequest('/api/v1/me'))
  },

  async login(input: LoginInput): Promise<CurrentAccount> {
    await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: {
        username: input.username,
        password: input.password,
        device_name: input.deviceName,
      },
    })
    return this.current()
  },

  async logout(): Promise<void> {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' })
  },
}
