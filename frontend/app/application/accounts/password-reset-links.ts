import type { BrowserLocationPort } from '../ports/browser-location'

export class BuildPasswordResetLink {
  constructor(private readonly location: BrowserLocationPort) {}

  execute(secret: string): string {
    return this.location.passwordResetUrl(secret)
  }
}

export class ConsumePasswordResetFragment {
  constructor(private readonly location: BrowserLocationPort) {}

  execute(): string | null {
    return this.location.consumeFragmentValue('token')
  }
}
