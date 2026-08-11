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
}

export interface Invitation {
  userId: string
  username: string
  displayName: string
  activationSecret: string
  expiresAt: string
}
