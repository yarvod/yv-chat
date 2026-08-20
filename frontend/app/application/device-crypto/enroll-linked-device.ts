import type { ConversationCryptoGateway } from '../ports/conversation-crypto-gateway'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { Scheduler } from '../ports/scheduler'
import type {
  ReconcileConversationCryptoResult,
} from '../conversation-crypto/reconcile-conversation-crypto'

export interface LinkedDeviceEnrollmentSession {
  setBeforeEpochAdvance(callback: (conversationId: string) => Promise<void>): void
  invalidateConversation(conversationId: string): void
  reconcileConversation(conversationId: string): Promise<ReconcileConversationCryptoResult>
}

export interface LinkedDeviceEnrollmentProgress {
  readonly targetDeviceId: string
  readonly totalConversations: number
  readonly readyConversations: number
  readonly pendingConversationIds: readonly string[]
  readonly skippedConversationIds: readonly string[]
  readonly complete: boolean
}

type EpochDrainer = (ownerUserId: string, conversationId: string) => Promise<void>
type ProgressListener = (progress: LinkedDeviceEnrollmentProgress) => void
type ActivityGuard = () => Promise<void>
type TargetState =
  | { readonly state: 'ready', readonly generationId: string, readonly generationNumber: number }
  | { readonly state: 'pending' | 'skipped' }

const SKIPPABLE_BLOCK_REASONS = new Set(['missing_identity', 'protocol_failure'])

export class EnrollLinkedDevice {
  private readonly running = new Map<string, Promise<LinkedDeviceEnrollmentProgress>>()
  private cancelledGeneration = 0

  constructor(
    private readonly messaging: MessagingGateway,
    private readonly cryptoServer: ConversationCryptoGateway,
    private readonly cryptoSession: LinkedDeviceEnrollmentSession,
    private readonly scheduler: Scheduler,
    private readonly drainEpoch: EpochDrainer,
    private readonly retryIntervalMs = 1_500,
    private readonly maxAttempts = 40,
  ) {}

  enroll(
    ownerUserId: string,
    targetDeviceId: string,
    onProgress: ProgressListener = () => undefined,
    ensureActive: ActivityGuard = async () => undefined,
  ): Promise<LinkedDeviceEnrollmentProgress> {
    if (!ownerUserId || !targetDeviceId) throw new TypeError('device enrollment binding is required')
    const key = `${ownerUserId}:${targetDeviceId}`
    const existing = this.running.get(key)
    if (existing) return existing
    const generation = this.cancelledGeneration
    const operation = this.run(
      ownerUserId,
      targetDeviceId,
      generation,
      onProgress,
      ensureActive,
    )
    this.running.set(key, operation)
    void operation.finally(() => {
      if (this.running.get(key) === operation) this.running.delete(key)
    }).catch(() => undefined)
    return operation
  }

  async reconcileCurrentRoster(ownerUserId: string): Promise<void> {
    if (!ownerUserId) throw new TypeError('owner binding is required')
    this.configureEpochDrain(ownerUserId)
    const conversations = await this.messaging.listConversations()
    for (const conversation of conversations) {
      if (conversation.conversationType !== 'direct') continue
      this.cryptoSession.invalidateConversation(conversation.conversationId)
      try {
        await this.cryptoSession.reconcileConversation(conversation.conversationId)
      } catch {
        // Each direct stays fail-closed and can retry independently from its
        // durable conversation_updated event or the next foreground bootstrap.
      }
    }
  }

  cancelAll(): void {
    this.cancelledGeneration += 1
  }

  private async run(
    ownerUserId: string,
    targetDeviceId: string,
    generation: number,
    onProgress: ProgressListener,
    ensureActive: ActivityGuard,
  ): Promise<LinkedDeviceEnrollmentProgress> {
    this.configureEpochDrain(ownerUserId)
    await ensureActive()
    const conversations = (await this.messaging.listConversations())
      .filter(item => item.conversationType === 'direct')
    await ensureActive()
    let progress = this.progress(
      targetDeviceId,
      conversations.length,
      conversations.map(item => item.conversationId),
      [],
    )
    onProgress(progress)
    if (progress.complete) return progress
    const alignedGenerations = new Map<string, string>()

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (generation !== this.cancelledGeneration) return progress
      await ensureActive()
      const pending: string[] = []
      const skipped: string[] = []
      for (const conversation of conversations) {
        await ensureActive()
        const conversationId = conversation.conversationId
        const before = await this.targetState(conversationId, targetDeviceId)
        if (before.state === 'skipped') {
          alignedGenerations.delete(conversationId)
          skipped.push(conversationId)
          continue
        }
        if (
          before.state === 'ready'
          && alignedGenerations.get(conversationId) === before.generationId
        ) continue
        this.cryptoSession.invalidateConversation(conversationId)
        let reconciled: ReconcileConversationCryptoResult | null = null
        try {
          reconciled = await this.cryptoSession.reconcileConversation(conversationId)
        } catch {
          // The target may still be publishing its immutable identity/KeyPackage,
          // or this leaf may need a later durable retry. Verification below is
          // authoritative and does not treat a successful call as membership.
        }
        await ensureActive()
        const after = await this.targetState(conversationId, targetDeviceId)
        if (after.state === 'skipped') {
          alignedGenerations.delete(conversationId)
          skipped.push(conversationId)
        } else if (
          after.state !== 'ready'
          || reconciled?.status !== 'ready'
          || reconciled.generationId !== after.generationId
          || reconciled.generationNumber !== after.generationNumber
        ) {
          alignedGenerations.delete(conversationId)
          pending.push(conversationId)
        } else {
          alignedGenerations.set(conversationId, after.generationId)
        }
      }
      progress = this.progress(targetDeviceId, conversations.length, pending, skipped)
      onProgress(progress)
      if (progress.complete || generation !== this.cancelledGeneration) return progress
      await this.waitForRetry()
      await ensureActive()
    }
    return progress
  }

  private configureEpochDrain(ownerUserId: string): void {
    this.cryptoSession.setBeforeEpochAdvance(
      conversationId => this.drainEpoch(ownerUserId, conversationId),
    )
  }

  private async targetState(
    conversationId: string,
    targetDeviceId: string,
  ): Promise<TargetState> {
    try {
      const generation = await this.cryptoServer.getCurrent(conversationId)
      if (
        generation?.status === 'ready'
        && generation.requiredDevices.some(device => device.deviceId === targetDeviceId)
      ) return {
        state: 'ready',
        generationId: generation.generationId,
        generationNumber: generation.generationNumber,
      }
      if (
        generation?.status === 'blocked'
        && generation.blockReason !== null
        && SKIPPABLE_BLOCK_REASONS.has(generation.blockReason)
      ) return { state: 'skipped' }
      return { state: 'pending' }
    } catch {
      return { state: 'pending' }
    }
  }

  private progress(
    targetDeviceId: string,
    totalConversations: number,
    pendingConversationIds: readonly string[],
    skippedConversationIds: readonly string[],
  ): LinkedDeviceEnrollmentProgress {
    return {
      targetDeviceId,
      totalConversations,
      readyConversations: totalConversations
        - pendingConversationIds.length
        - skippedConversationIds.length,
      pendingConversationIds,
      skippedConversationIds,
      complete: pendingConversationIds.length === 0,
    }
  }

  private waitForRetry(): Promise<void> {
    return new Promise(resolve => {
      this.scheduler.once(this.retryIntervalMs, resolve)
    })
  }
}
