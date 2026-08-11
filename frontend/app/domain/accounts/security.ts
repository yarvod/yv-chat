export interface DeviceSession {
  sessionId: string
  deviceId: string
  deviceName: string
  isCurrent: boolean
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  loginIp: string | null
  lastIp: string | null
}

export type SecurityEventType =
  | 'login'
  | 'logout'
  | 'credential_replay'
  | 'device_renamed'
  | 'device_revoked'
  | 'other_sessions_revoked'
  | 'password_changed'
  | 'password_reset_issued'
  | 'password_reset_completed'
  | 'security_reset'

export interface SecurityEvent {
  id: string
  eventType: SecurityEventType
  createdAt: string
  actorSessionId: string | null
  targetDeviceId: string | null
}
