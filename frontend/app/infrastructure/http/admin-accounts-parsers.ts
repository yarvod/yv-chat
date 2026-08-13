import { ApplicationError } from '../../application/errors'
import type {
  ActivationReissue,
  Invitation,
  ManagedUser,
  ManagedUsersPage,
  ManagedUserUpdate,
  PasswordResetIssue,
} from '../../domain/accounts/managed-user'
import type {
  CreatedRegistrationInvitation,
  RegistrationInvitation,
  RegistrationInvitationsPage,
  RegistrationInvitationStatus,
} from '../../domain/accounts/registration-invitation'
import {
  booleanField,
  integerField,
  nullableStringField,
  record,
  stringField,
} from './runtime-parsers'

const INVITATION_STATUSES = new Set<RegistrationInvitationStatus>([
  'active', 'used', 'expired', 'revoked',
])

function parseRegistrationInvitation(value: unknown): RegistrationInvitation {
  const item = record(value)
  const status = stringField(item, 'status') as RegistrationInvitationStatus
  if (!INVITATION_STATUSES.has(status)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid invitation status')
  }
  return {
    invitationId: stringField(item, 'invitation_id'),
    label: nullableStringField(item, 'label'),
    status,
    createdByUsername: stringField(item, 'created_by_username'),
    registeredUserId: nullableStringField(item, 'registered_user_id'),
    registeredUsername: nullableStringField(item, 'registered_username'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
    usedAt: nullableStringField(item, 'used_at'),
    revokedAt: nullableStringField(item, 'revoked_at'),
  }
}

export function parseRegistrationInvitations(value: unknown): RegistrationInvitationsPage {
  const page = record(value)
  if (!Array.isArray(page.items)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid invitations')
  }
  return {
    items: page.items.map(parseRegistrationInvitation),
    total: integerField(page, 'total'),
    limit: integerField(page, 'limit'),
    offset: integerField(page, 'offset'),
  }
}

export function parseCreatedRegistrationInvitation(
  value: unknown,
): CreatedRegistrationInvitation {
  const item = record(value)
  return {
    invitationId: stringField(item, 'invitation_id'),
    label: nullableStringField(item, 'label'),
    activationSecret: stringField(item, 'activation_secret'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

function parseManagedUser(value: unknown): ManagedUser {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    username: stringField(item, 'username'),
    displayName: stringField(item, 'display_name'),
    isAdmin: booleanField(item, 'is_admin'),
    isActive: booleanField(item, 'is_active'),
    activationPending: booleanField(item, 'activation_pending'),
    canReactivate: booleanField(item, 'can_reactivate'),
    createdAt: stringField(item, 'created_at'),
    updatedAt: stringField(item, 'updated_at'),
    activeSessions: integerField(item, 'active_sessions'),
  }
}

export function parseManagedUsers(value: unknown): ManagedUsersPage {
  const page = record(value)
  const items = page.items
  if (!Array.isArray(items)) throw new ApplicationError(200, 'invalid-response', 'invalid users')
  return {
    items: items.map(parseManagedUser),
    total: integerField(page, 'total'),
    limit: integerField(page, 'limit'),
    offset: integerField(page, 'offset'),
  }
}

export function parseInvitation(value: unknown): Invitation {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    username: stringField(item, 'username'),
    displayName: stringField(item, 'display_name'),
    activationSecret: stringField(item, 'activation_secret'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

export function parseManagedUserUpdate(value: unknown): ManagedUserUpdate {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    displayName: stringField(item, 'display_name'),
    isActive: booleanField(item, 'is_active'),
    activationPending: booleanField(item, 'activation_pending'),
    canReactivate: booleanField(item, 'can_reactivate'),
    revokedSessions: integerField(item, 'revoked_sessions'),
  }
}

export function parseActivationReissue(value: unknown): ActivationReissue {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    activationSecret: stringField(item, 'activation_secret'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

export function parsePasswordResetIssue(value: unknown): PasswordResetIssue {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    resetSecret: stringField(item, 'reset_secret'),
    expiresAt: stringField(item, 'expires_at'),
    revokedSessions: integerField(item, 'revoked_sessions'),
  }
}
