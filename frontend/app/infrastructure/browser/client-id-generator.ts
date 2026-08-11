import type { ClientIdGenerator } from '../../application/ports/client-id-generator'

export class BrowserClientIdGenerator implements ClientIdGenerator {
  create(): string {
    return crypto.randomUUID()
  }
}
