import type { ServerHealthGateway } from '../../application/ports/server-health-gateway'
import type { ApiClient } from './api-client'

export class HttpServerHealthGateway implements ServerHealthGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async probe(): Promise<void> {
    await this.apiClient.request('/api/v1/health')
  }
}
