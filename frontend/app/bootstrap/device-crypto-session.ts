import type { InitializedDeviceCrypto } from '../application/device-crypto/initialize-device-crypto'
import { InitializeDeviceCrypto } from '../application/device-crypto/initialize-device-crypto'
import { EnsureDeviceKeyPackagePool } from '../application/device-crypto/ensure-key-package-pool'
import {
  ReconcileConversationCrypto,
  type ReconcileConversationCryptoCommand,
  type ReconcileConversationCryptoResult,
} from '../application/conversation-crypto/reconcile-conversation-crypto'
import { DeviceCryptoError } from '../application/device-crypto/errors'
import type { ClientIdGenerator } from '../application/ports/client-id-generator'
import type { ConversationCryptoGateway } from '../application/ports/conversation-crypto-gateway'
import type { ConversationCryptoStateRepository } from '../application/ports/conversation-crypto-state-repository'
import type { DeviceCryptoGateway, DeviceCryptoIdentityCommand } from '../application/ports/device-crypto-gateway'
import type { DeviceCryptoRegistryGateway } from '../application/ports/device-crypto-registry-gateway'
import type { DeviceKeyPackageGateway } from '../application/ports/device-key-package-gateway'
import type {
  BootstrapMlsConversationCommand,
  BootstrapMlsConversationResult,
  JoinMlsConversationCommand,
  MlsConversationGateway,
  MlsConversationStateResult,
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
} from '../application/ports/mls-conversation-gateway'

interface ActiveDeviceCryptoScope {
  readonly binding: string
  readonly gateway: DeviceCryptoGateway & MlsConversationGateway
  readonly reconcile: ReconcileConversationCrypto
  readonly initialized: InitializedDeviceCrypto
}

type CryptoGatewayFactory = () => DeviceCryptoGateway & MlsConversationGateway

export class DeviceCryptoSession implements MlsConversationGateway {
  private active: ActiveDeviceCryptoScope | null = null
  private initializing: { binding: string, promise: Promise<InitializedDeviceCrypto> } | null = null
  private readonly reconciliation = new Map<
    string,
    Promise<ReconcileConversationCryptoResult>
  >()
  private readonly readyConversations = new Map<string, ReconcileConversationCryptoResult>()
  private poolRefresh: Promise<void> | null = null

  constructor(
    private readonly registry: DeviceCryptoRegistryGateway,
    private readonly packages: DeviceKeyPackageGateway,
    private readonly conversations: ConversationCryptoGateway,
    private readonly state: ConversationCryptoStateRepository,
    private readonly ids: ClientIdGenerator,
    private readonly createGateway: CryptoGatewayFactory,
  ) {}

  async initialize(command: DeviceCryptoIdentityCommand): Promise<InitializedDeviceCrypto> {
    const binding = `${command.userId}:${command.deviceId}`
    if (this.active?.binding === binding) return this.active.initialized
    if (this.initializing?.binding === binding) return await this.initializing.promise
    if (this.initializing) await this.initializing.promise.catch(() => undefined)
    const promise = this.start(command, binding)
    this.initializing = { binding, promise }
    try {
      return await promise
    } finally {
      if (this.initializing?.promise === promise) this.initializing = null
    }
  }

  reconcileConversation(conversationId: string): Promise<ReconcileConversationCryptoResult> {
    const ready = this.readyConversations.get(conversationId)
    if (ready) return Promise.resolve(ready)
    const pending = this.reconciliation.get(conversationId)
    if (pending) return pending
    const active = this.requireActive()
    const operation = this.reconcileAfterPoolRefresh(active, conversationId)
    this.reconciliation.set(conversationId, operation)
    void operation.then((result) => {
      if (result.status === 'ready') this.readyConversations.set(conversationId, result)
    }, () => undefined).finally(() => {
      if (this.reconciliation.get(conversationId) === operation) {
        this.reconciliation.delete(conversationId)
      }
    })
    return operation
  }

  invalidateConversation(conversationId: string): void {
    this.readyConversations.delete(conversationId)
  }

  reconcile(command: ReconcileConversationCryptoCommand): Promise<ReconcileConversationCryptoResult> {
    return this.requireActive().reconcile.execute(command)
  }

  bootstrapConversation(
    command: BootstrapMlsConversationCommand,
  ): Promise<BootstrapMlsConversationResult> {
    return this.requireActive().gateway.bootstrapConversation(command)
  }

  joinConversation(command: JoinMlsConversationCommand): Promise<MlsConversationStateResult> {
    return this.requireActive().gateway.joinConversation(command)
  }

  protectMessage(command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult> {
    return this.requireActive().gateway.protectMessage(command)
  }

  unprotectMessage(command: UnprotectMlsMessageCommand): Promise<UnprotectMlsMessageResult> {
    return this.requireActive().gateway.unprotectMessage(command)
  }

  async dispose(): Promise<void> {
    if (this.initializing) await this.initializing.promise.catch(() => undefined)
    await this.disposeActive()
  }

  private async start(
    command: DeviceCryptoIdentityCommand,
    binding: string,
  ): Promise<InitializedDeviceCrypto> {
    await this.disposeActive()
    const gateway = this.createGateway()
    try {
      const initialized = await new InitializeDeviceCrypto(gateway, this.registry).execute(command)
      const pool = await new EnsureDeviceKeyPackagePool(this.packages, gateway).execute(
        command.deviceId,
      )
      const current = pool.revision === null
        ? initialized
        : { ...initialized, identity: { ...initialized.identity, revision: pool.revision } }
      this.active = {
        binding,
        gateway,
        initialized: current,
        reconcile: new ReconcileConversationCrypto(
          this.conversations,
          this.state,
          gateway,
          gateway,
          this.ids,
        ),
      }
      return current
    } catch (error) {
      await gateway.dispose().catch(() => undefined)
      throw error
    }
  }

  private async disposeActive(): Promise<void> {
    this.reconciliation.clear()
    this.readyConversations.clear()
    this.poolRefresh = null
    const current = this.active
    this.active = null
    if (current) await current.gateway.dispose()
  }

  private requireActive(): ActiveDeviceCryptoScope {
    if (!this.active) throw new DeviceCryptoError('not-provisioned')
    return this.active
  }

  private async reconcileAfterPoolRefresh(
    active: ActiveDeviceCryptoScope,
    conversationId: string,
  ): Promise<ReconcileConversationCryptoResult> {
    await this.ensurePool(active)
    return await active.reconcile.execute({
      conversationId,
      deviceId: active.initialized.identity.deviceId,
    })
  }

  private ensurePool(active: ActiveDeviceCryptoScope): Promise<void> {
    if (this.poolRefresh) return this.poolRefresh
    const operation = new EnsureDeviceKeyPackagePool(this.packages, active.gateway)
      .execute(active.initialized.identity.deviceId)
      .then(() => undefined)
    this.poolRefresh = operation
    void operation.then(() => undefined, () => undefined).finally(() => {
      if (this.poolRefresh === operation) this.poolRefresh = null
    })
    return operation
  }
}
