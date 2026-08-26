import type {
  ReconcileConversationCryptoResult,
} from '../conversation-crypto/reconcile-conversation-crypto'
import type {
  ConversationCryptoGateway,
  ConversationCryptoGeneration,
} from '../ports/conversation-crypto-gateway'

export type DeviceHistoryConversationState = 'ready' | 'pending' | 'skipped'

export interface DeviceHistoryCryptoSession {
  invalidateConversation(conversationId: string): void
  reconcileConversation(conversationId: string): Promise<ReconcileConversationCryptoResult>
}

const SKIPPABLE_BLOCK_REASONS = new Set(['missing_identity', 'protocol_failure'])

export class ClassifyDeviceHistoryConversation {
  constructor(
    private readonly server: ConversationCryptoGateway,
    private readonly session: DeviceHistoryCryptoSession,
  ) {}

  async execute(
    conversationId: string,
    currentDeviceId: string,
    targetDeviceId: string,
  ): Promise<DeviceHistoryConversationState> {
    if (!conversationId || !currentDeviceId || !targetDeviceId) {
      throw new TypeError('history conversation binding is required')
    }
    const before = await this.server.getCurrent(conversationId)
    const serverState = this.serverState(before, currentDeviceId, targetDeviceId)
    if (serverState !== 'ready') return serverState

    // A ready server generation is insufficient: a newly authorized browser
    // can still have no local MLS group, while an existing browser can cache an
    // older generation. Force reconciliation before any history ciphertext is
    // protected or consumed.
    this.session.invalidateConversation(conversationId)
    let local: ReconcileConversationCryptoResult
    try {
      local = await this.session.reconcileConversation(conversationId)
    } catch {
      return 'pending'
    }

    const after = await this.server.getCurrent(conversationId)
    const verified = this.serverState(after, currentDeviceId, targetDeviceId)
    if (verified !== 'ready' || after === null) return verified
    return local.status === 'ready'
      && local.generationId === after.generationId
      && local.generationNumber === after.generationNumber
      && local.epoch === after.epoch
      ? 'ready'
      : 'pending'
  }

  private serverState(
    generation: ConversationCryptoGeneration | null,
    currentDeviceId: string,
    targetDeviceId: string,
  ): DeviceHistoryConversationState {
    if (generation?.status === 'ready') {
      const required = new Set(generation.requiredDevices.map(device => device.deviceId))
      return required.has(currentDeviceId) && required.has(targetDeviceId)
        ? 'ready'
        : 'pending'
    }
    if (
      generation?.status === 'blocked'
      && generation.blockReason !== null
      && SKIPPABLE_BLOCK_REASONS.has(generation.blockReason)
    ) return 'skipped'
    return 'pending'
  }
}
