import { DeviceCryptoError } from '../../application/device-crypto/errors'
import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
  PublicKeyPackageValidationCommand,
  PublicKeyPackageValidationResult,
} from '../../application/ports/device-crypto-gateway'
import {
  parseWorkerResponse,
  requestEnvelope,
  type DeviceCryptoWorkerRequest,
} from './worker-protocol'

const DEFAULT_TIMEOUT_MS = 15_000

interface PendingRequest {
  resolve(value: DeviceCryptoIdentity | PublicKeyPackageValidationResult | { disposed: true }): void
  reject(reason: DeviceCryptoError): void
  timeout: ReturnType<typeof setTimeout>
}

type WorkerFactory = () => Worker

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./device-crypto.worker.ts', import.meta.url), {
    name: 'yv-chat-device-crypto',
    type: 'module',
  })
}

export class CryptoWorkerClient implements DeviceCryptoGateway {
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRequest>()
  private disposed = false

  constructor(
    workerFactory: WorkerFactory = defaultWorkerFactory,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {
    this.worker = workerFactory()
    this.worker.addEventListener('message', this.onMessage)
    this.worker.addEventListener('error', this.onWorkerFailure)
    this.worker.addEventListener('messageerror', this.onWorkerFailure)
  }

  provision(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    return this.identityRequest(requestEnvelope(this.requestId(), 'provision', command))
  }

  restore(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    return this.identityRequest(requestEnvelope(this.requestId(), 'restore', command))
  }

  checkpoint(): Promise<DeviceCryptoIdentity> {
    return this.identityRequest(requestEnvelope(this.requestId(), 'checkpoint'))
  }

  validateKeyPackage(
    command: PublicKeyPackageValidationCommand,
  ): Promise<PublicKeyPackageValidationResult> {
    return this.validationRequest(requestEnvelope(
      this.requestId(),
      'validate-key-package',
      command,
    ))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    try {
      const result = await this.send(requestEnvelope(this.requestId(), 'dispose'))
      if (!('disposed' in result)) throw new DeviceCryptoError('runtime-unavailable')
    } finally {
      this.disposed = true
      this.worker.removeEventListener('message', this.onMessage)
      this.worker.removeEventListener('error', this.onWorkerFailure)
      this.worker.removeEventListener('messageerror', this.onWorkerFailure)
      this.worker.terminate()
      this.rejectAll('runtime-unavailable')
    }
  }

  private async identityRequest(request: DeviceCryptoWorkerRequest): Promise<DeviceCryptoIdentity> {
    const result = await this.send(request)
    if ('disposed' in result || 'validated' in result) {
      throw new DeviceCryptoError('runtime-unavailable')
    }
    return result
  }

  private async validationRequest(
    request: DeviceCryptoWorkerRequest,
  ): Promise<PublicKeyPackageValidationResult> {
    const result = await this.send(request)
    if (!('validated' in result)) throw new DeviceCryptoError('runtime-unavailable')
    return result
  }

  private send(
    request: DeviceCryptoWorkerRequest,
  ): Promise<DeviceCryptoIdentity | PublicKeyPackageValidationResult | { disposed: true }> {
    if (this.disposed) return Promise.reject(new DeviceCryptoError('runtime-unavailable'))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new DeviceCryptoError('runtime-unavailable'))
      }, this.timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      try {
        this.worker.postMessage(request)
      } catch {
        clearTimeout(timeout)
        this.pending.delete(request.requestId)
        reject(new DeviceCryptoError('runtime-unavailable'))
      }
    })
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const response = parseWorkerResponse(event.data)
    if (!response) {
      this.rejectAll('runtime-unavailable')
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new DeviceCryptoError(response.error.code))
  }

  private readonly onWorkerFailure = (): void => {
    this.rejectAll('runtime-unavailable')
  }

  private rejectAll(code: DeviceCryptoError['code']): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new DeviceCryptoError(code))
    }
    this.pending.clear()
  }
}
