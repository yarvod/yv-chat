import { ApplicationError } from '../../application/errors'
import type { Invitation, ManagedUser } from '../../domain/accounts/managed-user'
import { booleanField, record, stringField } from './runtime-parsers'

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
  }
}

export function parseManagedUsers(value: unknown): ManagedUser[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid users')
  return value.map(parseManagedUser)
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
