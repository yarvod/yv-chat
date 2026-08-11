import { ApplicationError } from '../../application/errors'
import type {
  ActivationReissue,
  Invitation,
  ManagedUser,
  ManagedUsersPage,
  ManagedUserUpdate,
  PasswordResetIssue,
} from '../../domain/accounts/managed-user'
import { booleanField, integerField, record, stringField } from './runtime-parsers'

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
