import type {
  PasswordRecoveryGateway,
  PasswordResetResult,
} from '../ports/password-recovery-gateway'
import type { HapticsPort } from '../ports/haptics'

export class ResetPassword {
  constructor(
    private readonly gateway: PasswordRecoveryGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(secret: string, newPassword: string): Promise<PasswordResetResult> {
    try {
      const result = await this.gateway.resetPassword(secret, newPassword)
      this.haptics.perform('success')
      return result
    } catch (error) {
      this.haptics.perform('error')
      throw error
    }
  }
}
