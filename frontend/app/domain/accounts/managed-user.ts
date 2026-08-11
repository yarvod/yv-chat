export interface ManagedUser {
  userId: string
  username: string
  displayName: string
  isAdmin: boolean
  isActive: boolean
  activationPending: boolean
  canReactivate: boolean
  createdAt: string
  updatedAt: string
  activeSessions: number
}

export interface ManagedUsersPage {
  items: ManagedUser[]
  total: number
  limit: number
  offset: number
}

export interface Invitation {
  userId: string
  username: string
  displayName: string
  activationSecret: string
  expiresAt: string
}

export interface ManagedUserUpdate {
  userId: string
  displayName: string
  isActive: boolean
  activationPending: boolean
  canReactivate: boolean
  revokedSessions: number
}

export interface ActivationReissue {
  userId: string
  activationSecret: string
  expiresAt: string
}

export interface PasswordResetIssue {
  userId: string
  resetSecret: string
  expiresAt: string
  revokedSessions: number
}
