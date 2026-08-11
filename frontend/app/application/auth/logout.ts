import type { AuthGateway } from '../ports/auth-gateway'

export class Logout {
  constructor(private readonly authGateway: AuthGateway) {}

  execute(): Promise<void> {
    return this.authGateway.logout()
  }
}
