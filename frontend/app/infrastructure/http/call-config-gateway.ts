import { ApplicationError } from '../../application/errors'
import type { ApiClient } from './api-client'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApplicationError(200, 'invalid-response', 'invalid call configuration')
  }
  return value as Record<string, unknown>
}

export class HttpCallConfigGateway {
  constructor(private readonly client: ApiClient) {}

  async load(): Promise<{ enabled: boolean, configuration: RTCConfiguration }> {
    const value = record(await this.client.request('/api/v1/calls/config'))
    if (
      typeof value.enabled !== 'boolean'
      || value.media_encryption !== 'DTLS-SRTP'
      || !Array.isArray(value.ice_servers)
    ) {
      throw new ApplicationError(200, 'invalid-response', 'invalid call configuration')
    }
    const iceServers = value.ice_servers.map(item => {
      const server = record(item)
      if (
        !Array.isArray(server.urls)
        || server.urls.length === 0
        || !server.urls.every(url => typeof url === 'string' && url.length > 0)
        || (server.username !== null && typeof server.username !== 'string')
        || (server.credential !== null && typeof server.credential !== 'string')
      ) {
        throw new ApplicationError(200, 'invalid-response', 'invalid call configuration')
      }
      return {
        urls: server.urls as string[],
        ...(typeof server.username === 'string' ? { username: server.username } : {}),
        ...(typeof server.credential === 'string' ? { credential: server.credential } : {}),
      } satisfies RTCIceServer
    })
    return { enabled: value.enabled, configuration: { iceServers } }
  }
}
