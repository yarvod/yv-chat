export interface BrowserLocationPort {
  activationUrl(secret: string): string
  passwordResetUrl(secret: string): string
  consumeFragmentValue(name: string): string | null
}
