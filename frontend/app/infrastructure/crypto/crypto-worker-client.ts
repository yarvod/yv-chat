import { DeviceCryptoError } from '../../application/device-crypto/errors'
import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
  GenerateDeviceKeyPackagesCommand,
  GeneratedDeviceKeyPackages,
  PublicKeyPackageValidationCommand,
  PublicKeyPackageValidationResult,
} from '../../application/ports/device-crypto-gateway'
import type {
  BootstrapMlsConversationCommand,
  BootstrapMlsConversationResult,
  ApplyMlsCommitCommand,
  JoinMlsConversationCommand,
  InspectMlsConversationCommand,
  MlsConversationInspectionResult,
  MlsConversationGateway,
  MlsConversationStateResult,
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
  UpdateMlsConversationCommand,
  UpdateMlsConversationResult,
} from '../../application/ports/mls-conversation-gateway'
import {
  mlsRequestEnvelope,
  type MlsWorkerResult,
} from './mls-worker-protocol'
import {
  parseWorkerResponse,
  requestEnvelope,
  type DeviceCryptoWorkerRequest,
} from './worker-protocol'

const DEFAULT_TIMEOUT_MS = 15_000

interface PendingRequest {
  resolve(value: WorkerResult): void
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

type WorkerResult = DeviceCryptoIdentity | PublicKeyPackageValidationResult
  | GeneratedDeviceKeyPackages
  | MlsWorkerResult | { disposed: true }

export class CryptoWorkerClient implements DeviceCryptoGateway, MlsConversationGateway {
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

  async generateKeyPackages(
    command: GenerateDeviceKeyPackagesCommand,
  ): Promise<GeneratedDeviceKeyPackages> {
    const result = await this.send(requestEnvelope(
      this.requestId(),
      'generate-key-packages',
      command,
    ))
    if (!('keyPackages' in result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async bootstrapConversation(
    command: BootstrapMlsConversationCommand,
  ): Promise<BootstrapMlsConversationResult> {
    const result = await this.send(mlsRequestEnvelope(
      this.requestId(),
      'mls-bootstrap',
      command,
    ))
    if (!('commit' in result)) throw new DeviceCryptoError('worker-protocol')
    const welcome = result.welcome
    if (welcome === null) {
      throw new DeviceCryptoError('worker-protocol')
    }
    return { ...result, welcome }
  }

  async inspectConversation(
    command: InspectMlsConversationCommand,
  ): Promise<MlsConversationInspectionResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-inspect', command))
    if (!('deviceIds' in result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async joinConversation(
    command: JoinMlsConversationCommand,
  ): Promise<MlsConversationStateResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-join', command))
    if (!isConversationState(result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async rejoinConversation(
    command: JoinMlsConversationCommand,
  ): Promise<MlsConversationStateResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-rejoin', command))
    if (!isConversationState(result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async updateConversation(
    command: UpdateMlsConversationCommand,
  ): Promise<UpdateMlsConversationResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-update', command))
    if (!('commit' in result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async applyCommit(command: ApplyMlsCommitCommand): Promise<MlsConversationStateResult> {
    const result = await this.send(mlsRequestEnvelope(
      this.requestId(),
      'mls-apply-commit',
      command,
    ))
    if (!isConversationState(result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async protectMessage(command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-protect', command))
    if (!('ciphertext' in result)) throw new DeviceCryptoError('worker-protocol')
    return result
  }

  async unprotectMessage(
    command: UnprotectMlsMessageCommand,
  ): Promise<UnprotectMlsMessageResult> {
    const result = await this.send(mlsRequestEnvelope(this.requestId(), 'mls-unprotect', command))
    if (!('plaintext' in result)) throw new DeviceCryptoError('worker-protocol')
    return result
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
    if (!isDeviceIdentity(result)) {
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
  ): Promise<WorkerResult> {
    if (this.disposed) return Promise.reject(new DeviceCryptoError('runtime-unavailable'))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new DeviceCryptoError('worker-timeout'))
      }, this.timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      try {
        this.worker.postMessage(request)
      } catch {
        clearTimeout(timeout)
        this.pending.delete(request.requestId)
        reject(new DeviceCryptoError('worker-failed'))
      }
    })
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const response = parseWorkerResponse(event.data)
    if (!response) {
      this.rejectAll('worker-protocol')
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
    this.rejectAll('worker-failed')
  }

  private rejectAll(code: DeviceCryptoError['code']): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new DeviceCryptoError(code))
    }
    this.pending.clear()
  }
}

function isDeviceIdentity(result: WorkerResult): result is DeviceCryptoIdentity {
  return 'credentialIdentity' in result
}

function isConversationState(result: WorkerResult): result is MlsConversationStateResult {
  return 'epoch' in result
    && 'revision' in result
    && !('commit' in result)
    && !('ciphertext' in result)
}
