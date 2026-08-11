import type { PwaUpdateGateway } from '../../application/ports/pwa-update-gateway'

interface PwaRegistrationProvider {
  getSWRegistration(): ServiceWorkerRegistration | undefined
}

export class VitePwaUpdateGateway implements PwaUpdateGateway {
  constructor(private readonly provider: PwaRegistrationProvider | undefined) {}

  async check(): Promise<void> {
    await this.provider?.getSWRegistration()?.update()
  }
}
