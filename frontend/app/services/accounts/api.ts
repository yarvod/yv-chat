import { apiRequest } from '../api'
import { parseActivation, parseInvitation, parseManagedUsers } from './parsers'
import type { ActivationResult, Invitation, ManagedUser } from './types'

export const accountAdminService = {
  async list(): Promise<ManagedUser[]> {
    return parseManagedUsers(await apiRequest('/api/v1/admin/users'))
  },
  async invite(username: string, displayName: string): Promise<Invitation> {
    return parseInvitation(await apiRequest('/api/v1/admin/users', {
      method: 'POST',
      body: { username, display_name: displayName },
    }))
  },
}

export const activationService = {
  async activate(activationSecret: string, password: string): Promise<ActivationResult> {
    return parseActivation(await apiRequest('/api/v1/auth/activate', {
      method: 'POST',
      body: { activation_secret: activationSecret, password },
    }))
  },
}
