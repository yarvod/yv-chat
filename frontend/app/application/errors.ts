export type ApplicationErrorKind = 'http' | 'network' | 'invalid-response'

export class ApplicationError extends Error {
  constructor(
    readonly status: number | null,
    readonly kind: ApplicationErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}
