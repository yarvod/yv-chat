import { ApplicationError } from '../../application/errors'

export interface BinaryUploadProgress {
  uploadedBytes: number
  totalBytes: number
}

export type BinaryUploadProgressHandler = (progress: BinaryUploadProgress) => void

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

  async upload(
    path: string,
    body: Blob,
    onProgress?: BinaryUploadProgressHandler,
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/octet-stream',
    })
    const token = csrfToken()
    if (token) headers.set('X-CSRF-Token', token)
    return await new Promise<unknown>((resolve, reject) => {
      const request = new XMLHttpRequest()
      let settled = false

      const rejectNetwork = (): void => {
        if (settled) return
        settled = true
        reject(new ApplicationError(null, 'network', 'network unavailable'))
      }

      request.open('PUT', path)
      request.withCredentials = true
      for (const [name, value] of headers.entries()) request.setRequestHeader(name, value)
      request.upload.onprogress = event => {
        const uploadedBytes = Math.max(0, Math.min(body.size, event.loaded))
        onProgress?.({ uploadedBytes, totalBytes: body.size })
      }
      request.onerror = rejectNetwork
      request.onabort = rejectNetwork
      request.ontimeout = rejectNetwork
      request.onload = () => {
        if (settled) return
        settled = true
        if (request.status < 200 || request.status >= 300) {
          reject(new ApplicationError(
            request.status,
            'http',
            `request failed: ${request.status}`,
          ))
          return
        }
        let result: unknown
        try {
          result = JSON.parse(request.responseText) as unknown
        } catch {
          reject(new ApplicationError(
            request.status,
            'invalid-response',
            'invalid server response',
          ))
          return
        }
        onProgress?.({ uploadedBytes: body.size, totalBytes: body.size })
        resolve(result)
      }
      onProgress?.({ uploadedBytes: 0, totalBytes: body.size })
      request.send(body)
    })
  }

  async download(path: string): Promise<Blob> {
    let response: Response
    try {
      response = await fetch(path, {
        method: 'GET',
        headers: new Headers({ Accept: 'application/octet-stream,image/*,video/*' }),
        credentials: 'include',
      })
    } catch {
      throw new ApplicationError(null, 'network', 'network unavailable')
    }
    if (!response.ok) {
      throw new ApplicationError(response.status, 'http', `request failed: ${response.status}`)
    }
    try {
      return await response.blob()
    } catch {
      throw new ApplicationError(response.status, 'invalid-response', 'invalid binary response')
    }
  }
}
