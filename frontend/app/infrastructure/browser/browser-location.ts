import type { BrowserLocationPort } from '../../application/ports/browser-location'

export class BrowserLocation implements BrowserLocationPort {
  constructor(
    private readonly locationRef: Location = window.location,
    private readonly historyRef: History = window.history,
  ) {}

  activationUrl(secret: string): string {
    return this.secretUrl('/activate', secret)
  }

  passwordResetUrl(secret: string): string {
    return this.secretUrl('/reset-password', secret)
  }

  private secretUrl(path: string, secret: string): string {
    const url = new URL(path, this.locationRef.origin)
    url.hash = new URLSearchParams({ token: secret }).toString()
    return url.toString()
  }

  consumeFragmentValue(name: string): string | null {
    const value = new URLSearchParams(this.locationRef.hash.slice(1)).get(name)
    if (this.locationRef.hash.length > 0) {
      this.historyRef.replaceState(null, '', `${this.locationRef.pathname}${this.locationRef.search}`)
    }
    return value
  }
}
