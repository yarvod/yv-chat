import { ApplicationError } from '../../application/errors'
import type {
  DeviceSession,
  SecurityEvent,
  SecurityEventType,
} from '../../domain/accounts/security'
import {
  booleanField,
  integerField,
  nullableStringField,
  record,
  stringField,
} from './runtime-parsers'

function parseDeviceSession(value: unknown): DeviceSession {
  const item = record(value)
  return {
    sessionId: stringField(item, 'session_id'),
    deviceId: stringField(item, 'device_id'),
    deviceName: stringField(item, 'device_name'),
    isCurrent: booleanField(item, 'is_current'),
    createdAt: stringField(item, 'created_at'),
    lastSeenAt: stringField(item, 'last_seen_at'),
    idleExpiresAt: stringField(item, 'idle_expires_at'),
    absoluteExpiresAt: stringField(item, 'absolute_expires_at'),
    loginIp: nullableStringField(item, 'login_ip'),
    lastIp: nullableStringField(item, 'last_ip'),
  }
}

export function parseDeviceSessions(value: unknown): DeviceSession[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid devices')
  return value.map(parseDeviceSession)
}

function parseSecurityEvent(value: unknown): SecurityEvent {
  const item = record(value)
  const eventType = stringField(item, 'event_type')
  if (!SECURITY_EVENT_TYPES.has(eventType as SecurityEventType)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid event type')
  }
  return {
    id: stringField(item, 'id'),
    eventType: eventType as SecurityEventType,
    createdAt: stringField(item, 'created_at'),
    actorSessionId: nullableStringField(item, 'actor_session_id'),
    targetDeviceId: nullableStringField(item, 'target_device_id'),
  }
}

const SECURITY_EVENT_TYPES = new Set<SecurityEventType>([
  'login',
  'logout',
  'credential_replay',
  'device_renamed',
  'device_revoked',
  'other_sessions_revoked',
  'password_changed',
  'password_reset_issued',
  'password_reset_completed',
  'security_reset',
])

export function parseSecurityEvents(value: unknown): SecurityEvent[] {
  if (!Array.isArray(value)) throw new ApplicationError(200, 'invalid-response', 'invalid events')
  return value.map(parseSecurityEvent)
}

export function parseRevokedCount(value: unknown): number {
  return integerField(record(value), 'revoked_count')
}

export function parseChangedPasswordCount(value: unknown): number {
  return integerField(record(value), 'revoked_sessions')
}
