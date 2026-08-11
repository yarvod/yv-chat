import type { BrowserLocationPort } from '../ports/browser-location'

export class BuildInvitationLink {
  constructor(private readonly location: BrowserLocationPort) {}

  execute(secret: string): string {
    return this.location.activationUrl(secret)
  }
}

export class ConsumeActivationFragment {
  constructor(private readonly location: BrowserLocationPort) {}

  execute(): string | null {
    return this.location.consumeFragmentValue('token')
  }
}
