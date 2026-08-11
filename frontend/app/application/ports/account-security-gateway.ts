import type { CurrentAccount } from '../../domain/accounts/account'
import type { DeviceSession, SecurityEvent } from '../../domain/accounts/security'

export interface AccountSecurityGateway {
  updateProfile(displayName: string): Promise<CurrentAccount>
  listDevices(): Promise<DeviceSession[]>
  renameDevice(deviceId: string, name: string): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
  revokeOtherSessions(): Promise<number>
  changePassword(currentPassword: string, newPassword: string): Promise<number>
  securityReset(currentPassword: string): Promise<void>
  listSecurityEvents(limit: number): Promise<SecurityEvent[]>
}
