import type { ActivationGateway, ActivationResult } from '../ports/activation-gateway'
import type { HapticsPort } from '../ports/haptics'

export class ActivateAccount {
  constructor(
    private readonly gateway: ActivationGateway,
    private readonly haptics: HapticsPort,
  ) {}

  async execute(secret: string, password: string): Promise<ActivationResult> {
    try {
      const result = await this.gateway.activate(secret, password)
      this.haptics.perform('success')
      return result
    } catch (error) {
      this.haptics.perform('error')
      throw error
    }
  }
}
