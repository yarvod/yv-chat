import { ApplicationError } from '../../application/errors'
import type { CurrentAccount } from '../../domain/accounts/account'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApplicationError(200, 'invalid-response', 'expected object')
  return value
}

export function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name]
  if (typeof field !== 'string' || field.length === 0) {
    throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  }
  return field
}

export function nullableStringField(value: Record<string, unknown>, name: string): string | null {
  const field = value[name]
  if (field !== null && typeof field !== 'string') {
    throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  }
  return field
}

export function integerField(value: Record<string, unknown>, name: string): number {
  const field = value[name]
  if (!Number.isSafeInteger(field) || Number(field) < 0) {
    throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  }
  return Number(field)
}

export function booleanField(value: Record<string, unknown>, name: string): boolean {
  const field = value[name]
  if (typeof field !== 'boolean') {
    throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  }
  return field
}

export function arrayField(value: Record<string, unknown>, name: string): unknown[] {
  const field = value[name]
  if (!Array.isArray(field)) {
    throw new ApplicationError(200, 'invalid-response', `invalid ${name}`)
  }
  return field
}

export function parseCurrentAccount(value: unknown): CurrentAccount {
  const item = record(value)
  if (typeof item.is_admin !== 'boolean') {
    throw new ApplicationError(200, 'invalid-response', 'invalid is_admin')
  }
  return {
    userId: stringField(item, 'user_id'),
    username: stringField(item, 'username'),
    displayName: stringField(item, 'display_name'),
    isAdmin: item.is_admin,
    createdAt: stringField(item, 'created_at'),
    updatedAt: stringField(item, 'updated_at'),
  }
}

export function parseActivation(value: unknown): { userId: string, activatedAt: string } {
  const item = record(value)
  return {
    userId: stringField(item, 'user_id'),
    activatedAt: stringField(item, 'activated_at'),
  }
}
