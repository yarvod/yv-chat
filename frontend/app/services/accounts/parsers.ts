import { ApiError } from '../api'
import { booleanField, record, stringField } from '../parsers'
import type { ActivationResult, Invitation, ManagedUser } from './types'

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
  if (!Array.isArray(value)) throw new ApiError(200, 'invalid-response', 'invalid users')
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

export function parseActivation(value: unknown): ActivationResult {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    activatedAt: stringField(item, 'activated_at'),
  }
}
