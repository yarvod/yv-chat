import { DeviceCryptoError } from '../device-crypto/errors'
import type { ClientIdGenerator } from '../ports/client-id-generator'
import type {
  ConversationCryptoGateway,
  ConversationCryptoGeneration,
} from '../ports/conversation-crypto-gateway'
import type {
  ConversationCryptoLocalState,
  ConversationCryptoStateRepository,
} from '../ports/conversation-crypto-state-repository'
import type { DeviceCryptoGateway } from '../ports/device-crypto-gateway'
import type { MlsConversationGateway } from '../ports/mls-conversation-gateway'

export interface ReconcileConversationCryptoCommand {
  readonly conversationId: string
  readonly deviceId: string
}

export interface ReconcileConversationCryptoResult {
  readonly status: 'blocked' | 'pending' | 'ready'
  readonly generationId: string
  readonly generationNumber: number
  readonly blockReason: string | null
  readonly epoch: number | null
}

export class ReconcileConversationCrypto {
  constructor(
    private readonly server: ConversationCryptoGateway,
    private readonly state: ConversationCryptoStateRepository,
    private readonly deviceCrypto: DeviceCryptoGateway,
    private readonly mls: MlsConversationGateway,
    private readonly ids: ClientIdGenerator,
  ) {}

  async execute(
    command: ReconcileConversationCryptoCommand,
  ): Promise<ReconcileConversationCryptoResult> {
    if (!command.conversationId || !command.deviceId) {
      throw new TypeError('conversation and device binding is required')
    }
    let local = await this.state.load(command.deviceId, command.conversationId)
    let generation = await this.server.getCurrent(command.conversationId)
    if (generation === null || generation.status === 'blocked') {
      const bootstrapRequestId = generation === null
        && local?.phase === 'bootstrap-requested'
        && local.generationId === null
        ? local.bootstrapRequestId
        : this.ids.create()
      local = bootstrapState(command, bootstrapRequestId)
      await this.state.save(local)
      generation = await this.server.begin(command.conversationId, bootstrapRequestId)
    }
    this.assertGenerationBinding(generation, command.conversationId)
    if (generation.status === 'blocked') return result(generation)
    if (generation.coordinatorDeviceId === command.deviceId) {
      return await this.reconcileCoordinator(command, generation, local)
    }
    return await this.reconcileMember(command, generation, local)
  }

  private async reconcileCoordinator(
    command: ReconcileConversationCryptoCommand,
    generation: ConversationCryptoGeneration,
    local: ConversationCryptoLocalState | null,
  ): Promise<ReconcileConversationCryptoResult> {
    if (generation.status === 'ready') {
      if (!sameGeneration(local, generation) || (
        local.phase !== 'coordinator-checkpointed' && local.phase !== 'ready'
      )) throw new DeviceCryptoError('conflict')
      await this.state.save(readyState(local, generation))
      return result(generation)
    }

    let checkpoint = sameGeneration(local, generation)
      && local.phase === 'coordinator-checkpointed'
      ? local
      : null
    if (checkpoint === null) {
      const targets = generation.requiredDevices.filter(device => !device.isCoordinator)
      for (const target of targets) {
        if (
          target.fingerprint === null
          || target.credentialIdentity === null
          || target.signaturePublicKey === null
          || target.keyPackageRef === null
          || target.keyPackage === null
        ) throw new DeviceCryptoError('conflict')
        await this.deviceCrypto.validateKeyPackage({
          targetUserId: target.userId,
          targetDeviceId: target.deviceId,
          credentialIdentity: target.credentialIdentity,
          signaturePublicKey: target.signaturePublicKey,
          fingerprint: target.fingerprint,
          packageRef: target.keyPackageRef,
          keyPackage: target.keyPackage,
        })
      }
      const created = await this.mls.bootstrapConversation({
        conversationId: command.conversationId,
        keyPackages: targets.map(target => target.keyPackage as Uint8Array),
      })
      checkpoint = {
        ownerDeviceId: command.deviceId,
        conversationId: command.conversationId,
        bootstrapRequestId: local?.bootstrapRequestId ?? this.ids.create(),
        generationId: generation.generationId,
        generationNumber: generation.generationNumber,
        phase: 'coordinator-checkpointed',
        epoch: created.epoch,
        commit: created.commit.slice(),
        ratchetTree: created.ratchetTree.slice(),
        welcome: created.welcome.slice(),
        targetDeviceIds: targets.map(target => target.deviceId),
        updatedAt: new Date().toISOString(),
      }
      await this.state.save(checkpoint)
    }
    if (
      checkpoint.epoch === null
      || checkpoint.commit === null
      || checkpoint.ratchetTree === null
      || checkpoint.welcome === null
    ) throw new DeviceCryptoError('corrupt-state')
    const finalized = await this.server.finalize({
      conversationId: command.conversationId,
      generationId: generation.generationId,
      epoch: checkpoint.epoch,
      commit: checkpoint.commit,
      ratchetTree: checkpoint.ratchetTree,
      welcomes: checkpoint.targetDeviceIds.map(targetDeviceId => ({
        targetDeviceId,
        welcome: checkpoint.welcome as Uint8Array,
      })),
    })
    this.assertReadyFinalization(generation, finalized)
    await this.state.save(readyState(checkpoint, finalized))
    return result(finalized)
  }

  private async reconcileMember(
    command: ReconcileConversationCryptoCommand,
    generation: ConversationCryptoGeneration,
    local: ConversationCryptoLocalState | null,
  ): Promise<ReconcileConversationCryptoResult> {
    if (generation.status === 'pending') return result(generation)
    const welcome = generation.welcome
    if (
      welcome === null
      || welcome.targetDeviceId !== command.deviceId
      || generation.ratchetTree === null
      || generation.epoch === null
    ) throw new DeviceCryptoError('conflict')
    let joined = sameGeneration(local, generation)
      && (local.phase === 'joined' || local.phase === 'ready')
      ? local
      : null
    if (joined === null) {
      const state = await this.mls.joinConversation({
        conversationId: command.conversationId,
        welcome: welcome.welcome,
        ratchetTree: generation.ratchetTree,
      })
      if (state.epoch !== generation.epoch) throw new DeviceCryptoError('conflict')
      joined = {
        ownerDeviceId: command.deviceId,
        conversationId: command.conversationId,
        bootstrapRequestId: local?.bootstrapRequestId ?? this.ids.create(),
        generationId: generation.generationId,
        generationNumber: generation.generationNumber,
        phase: 'joined',
        epoch: state.epoch,
        commit: null,
        ratchetTree: null,
        welcome: null,
        targetDeviceIds: [],
        updatedAt: new Date().toISOString(),
      }
      await this.state.save(joined)
    }
    if (welcome.acknowledgedAt === null) {
      await this.server.acknowledgeWelcome(command.conversationId, generation.generationId)
    }
    await this.state.save(readyState(joined, generation))
    return result(generation)
  }

  private assertGenerationBinding(
    generation: ConversationCryptoGeneration,
    conversationId: string,
  ): void {
    if (generation.conversationId !== conversationId || generation.protocolVersion !== 2) {
      throw new DeviceCryptoError('conflict')
    }
  }

  private assertReadyFinalization(
    pending: ConversationCryptoGeneration,
    ready: ConversationCryptoGeneration,
  ): void {
    if (
      ready.status !== 'ready'
      || ready.generationId !== pending.generationId
      || ready.conversationId !== pending.conversationId
      || ready.generationNumber !== pending.generationNumber
    ) throw new DeviceCryptoError('conflict')
  }
}

function bootstrapState(
  command: ReconcileConversationCryptoCommand,
  bootstrapRequestId: string,
): ConversationCryptoLocalState {
  return {
    ownerDeviceId: command.deviceId,
    conversationId: command.conversationId,
    bootstrapRequestId,
    generationId: null,
    generationNumber: null,
    phase: 'bootstrap-requested',
    epoch: null,
    commit: null,
    ratchetTree: null,
    welcome: null,
    targetDeviceIds: [],
    updatedAt: new Date().toISOString(),
  }
}

function sameGeneration(
  local: ConversationCryptoLocalState | null,
  generation: ConversationCryptoGeneration,
): local is ConversationCryptoLocalState {
  return local !== null
    && local.generationId === generation.generationId
    && local.generationNumber === generation.generationNumber
}

function readyState(
  local: ConversationCryptoLocalState,
  generation: ConversationCryptoGeneration,
): ConversationCryptoLocalState {
  return {
    ...local,
    phase: 'ready',
    epoch: generation.epoch,
    commit: null,
    ratchetTree: null,
    welcome: null,
    targetDeviceIds: [],
    updatedAt: new Date().toISOString(),
  }
}

function result(generation: ConversationCryptoGeneration): ReconcileConversationCryptoResult {
  return {
    status: generation.status,
    generationId: generation.generationId,
    generationNumber: generation.generationNumber,
    blockReason: generation.blockReason,
    epoch: generation.epoch,
  }
}
