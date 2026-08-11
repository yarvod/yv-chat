import type { CurrentAccount } from '../../domain/accounts/account'
import type { AuthGateway } from '../ports/auth-gateway'

export class LoadCurrentAccount {
  constructor(private readonly authGateway: AuthGateway) {}

  execute(): Promise<CurrentAccount> {
    return this.authGateway.current()
  }
}
