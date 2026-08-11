export interface ActivationResult {
  userId: string
  activatedAt: string
}

export interface ActivationGateway {
  activate(secret: string, password: string): Promise<ActivationResult>
}
