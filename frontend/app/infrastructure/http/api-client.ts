import { ApplicationError } from '../../application/errors'

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

function csrfToken(): string | null {
  const prefix = '__Host-yv_csrf='
  const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))
  return item ? decodeURIComponent(item.slice(prefix.length)) : null
}

export class ApiClient {
  async request(path: string, request: ApiRequest = {}): Promise<unknown> {
    const method = request.method ?? 'GET'
    const headers = new Headers({ Accept: 'application/json' })
    if (request.body !== undefined) headers.set('Content-Type', 'application/json')
    if (method !== 'GET') {
      const token = csrfToken()
      if (token) headers.set('X-CSRF-Token', token)
    }

    let response: Response
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: 'include',
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      })
    } catch {
      throw new ApplicationError(null, 'network', 'network unavailable')
    }
    if (!response.ok) {
      throw new ApplicationError(response.status, 'http', `request failed: ${response.status}`)
    }
    if (response.status === 204) return null
    try {
      return await response.json()
    } catch {
      throw new ApplicationError(response.status, 'invalid-response', 'invalid server response')
    }
  }
}
