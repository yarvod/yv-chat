export type RegistrationInvitationStatus = 'active' | 'used' | 'expired' | 'revoked'

export interface RegistrationInvitation {
  invitationId: string
  label: string | null
  status: RegistrationInvitationStatus
  createdByUsername: string
  registeredUserId: string | null
  registeredUsername: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
}

export interface RegistrationInvitationsPage {
  items: RegistrationInvitation[]
  total: number
  limit: number
  offset: number
}

export interface CreatedRegistrationInvitation {
  invitationId: string
  label: string | null
  activationSecret: string
  createdAt: string
  expiresAt: string
}
