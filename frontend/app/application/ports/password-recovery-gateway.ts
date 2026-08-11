export interface PasswordResetResult {
  userId: string
  resetAt: string
  revokedSessions: number
}

export interface PasswordRecoveryGateway {
  resetPassword(secret: string, newPassword: string): Promise<PasswordResetResult>
}
