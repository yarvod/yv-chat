import type { ArchivedMessage, MessageArchive } from '../ports/message-archive'
import type { DeviceHistorySyncJob, DeviceHistorySyncJobStore } from '../ports/device-history-sync-jobs'
import type { DevicePairingGateway } from '../ports/device-pairing-gateway'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'
import type { ProtocolMessageProtection } from '../messaging/message-protection'
import { MessageProtectionError } from '../messaging/message-protection'
import { ApplicationError } from '../errors'

const CHUNK_RECORD_LIMIT = 20
const MAX_CHUNKS_PER_CONVERSATION = 20
const MAX_TRANSFER_RECORDS = CHUNK_RECORD_LIMIT * MAX_CHUNKS_PER_CONVERSATION
const PACKED_CHUNK_RECORD_LIMIT = 100
const PACKED_CHUNK_RECORDS_BYTES = 190 * 1024
const PEER_POLL_BASE_DELAY_MS = 4_000
const PEER_POLL_STAGGER_MS = 2_000
// Production ingress allows 120 pairing requests/minute per public IP. Two
// linked devices commonly share that IP, so each peer must stay below one
// relay request/second with enough headroom for the other peer and control
// traffic. This applies to uploads and ACKs too, not only polling.
const RELAY_REQUEST_INTERVAL_MS = 1_250
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface HistoryTransferPayload {
  type: 'yv-chat-device-history'
  version: 1 | 2 | 3 | 4
  pairingId: string
  senderDeviceId: string
  targetDeviceId: string
  conversationId: string
  clientChunkId: string
  records: ArchivedMessage[]
  complete?: true
  skippedConversationIds?: string[]
}

export type DeviceHistorySyncStage =
  | 'queued'
  | 'preparing_crypto'
  | 'transferring'
  | 'waiting_peer'
  | 'retrying'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'complete'

export type DeviceHistorySyncFailure =
  | 'network'
  | 'rate_limited'
  | 'server'
  | 'pairing_unavailable'
  | 'stopped'
  | 'unknown'

export interface DeviceHistorySyncProgress {
  ownerUserId: string
  currentDeviceId: string
  pairingId: string
  targetDeviceId: string
  stage: DeviceHistorySyncStage
  totalConversations: number
  readyConversations: number
  confirmedConversations: number
  skippedConversations: number
  exportedRecords: number
  importedRecords: number
  importRevision: number
  gaps: number
  complete: boolean
  failure: DeviceHistorySyncFailure | null
  importedConversationIds: readonly string[]
  skippedConversationIds: readonly string[]
}

type ProgressListener = (progress: DeviceHistorySyncProgress) => void
type StatusListener = (progress: DeviceHistorySyncProgress) => void
type TargetPreparer = (
  ownerUserId: string,
  targetDeviceId: string,
  onProgress: (progress: {
    totalConversations: number
    readyConversations: number
    skippedConversationIds?: readonly string[]
  }) => void,
  ensureActive: () => Promise<void>,
) => Promise<{
  complete: boolean
  totalConversations: number
  readyConversations: number
  skippedConversationIds?: readonly string[]
}>
type ConversationState = 'ready' | 'pending' | 'skipped'
type ConversationClassifier = (
  conversationId: string,
  currentDeviceId: string,
  targetDeviceId: string,
) => Promise<ConversationState>

class DeviceHistorySyncCancelled extends Error {}
class HistoryTransferBindingError extends Error {}
class InvalidHistoryTransfer extends Error {}

function failureFrom(error: unknown): {
  failure: DeviceHistorySyncFailure
  terminal: boolean
} {
  if (error instanceof ApplicationError) {
    if (error.status === 410) return { failure: 'stopped', terminal: true }
    if ([401, 404, 409].includes(error.status ?? 0)) {
      return { failure: 'pairing_unavailable', terminal: true }
    }
    if (error.status === 429) return { failure: 'rate_limited', terminal: false }
    if (error.kind === 'network' || error.status === 408) {
      return { failure: 'network', terminal: false }
    }
    if (
      error.kind === 'invalid-response'
      || (error.status !== null && error.status >= 500)
    ) {
      return { failure: 'server', terminal: false }
    }
    return { failure: 'unknown', terminal: true }
  }
  return { failure: 'unknown', terminal: false }
}

function retryDelayMilliseconds(
  failure: DeviceHistorySyncFailure,
  attempt: number,
  currentDeviceId: string,
): number {
  if (failure !== 'rate_limited') return 1_500
  const deviceJitter = Number.parseInt(currentDeviceId.slice(-4), 16) % 2_500
  const boundedAttempt = Math.min(attempt, 3)
  return Math.min(27_500, 5_000 * (2 ** boundedAttempt)) + deviceJitter
}

function peerPollDelayMilliseconds(currentDeviceId: string): number {
  const deviceStagger = Number.parseInt(currentDeviceId.slice(-4), 16) % PEER_POLL_STAGGER_MS
  return PEER_POLL_BASE_DELAY_MS + deviceStagger
}

function packedRecordChunks(values: readonly ArchivedMessage[]): ArchivedMessage[][] {
  const result: ArchivedMessage[][] = []
  let current: ArchivedMessage[] = []
  for (const value of values) {
    const candidate = [...current, value]
    const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength
    if (
      current.length > 0
      && (candidate.length > PACKED_CHUNK_RECORD_LIMIT
        || candidateBytes > PACKED_CHUNK_RECORDS_BYTES)
    ) {
      result.push(current)
      current = [value]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) result.push(current)
  return result.slice(-MAX_CHUNKS_PER_CONVERSATION)
}

function transferRecords(
  value: unknown,
  expected: Omit<HistoryTransferPayload, 'version' | 'records' | 'complete'>,
): { records: ArchivedMessage[], complete: boolean, skippedConversationIds: string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidHistoryTransfer()
  }
  const payload = value as Record<string, unknown>
  if (
    payload.type !== expected.type
    || payload.pairingId !== expected.pairingId
    || payload.senderDeviceId !== expected.senderDeviceId
    || payload.targetDeviceId !== expected.targetDeviceId
    || payload.conversationId !== expected.conversationId
    || payload.clientChunkId !== expected.clientChunkId
  ) throw new HistoryTransferBindingError()
  if (
    (payload.version !== 1 && payload.version !== 2
      && payload.version !== 3 && payload.version !== 4)
    || !Array.isArray(payload.records)
    || (payload.version === 1 && (
      payload.records.length === 0 || payload.records.length > CHUNK_RECORD_LIMIT
    ))
    || (payload.version === 2 && (
      payload.records.length !== 0
      || payload.complete !== true
      || payload.skippedConversationIds !== undefined
    ))
    || (payload.version === 3 && (
      payload.records.length !== 0
      || payload.complete !== true
      || !Array.isArray(payload.skippedConversationIds)
      || payload.skippedConversationIds.length > 100
      || payload.skippedConversationIds.some(
        value => typeof value !== 'string' || !UUID.test(value),
      )
      || new Set(payload.skippedConversationIds).size !== payload.skippedConversationIds.length
    ))
    || (payload.version === 4 && (
      payload.records.length === 0
      || payload.records.length > PACKED_CHUNK_RECORD_LIMIT
      || (payload.complete !== undefined && payload.complete !== true)
      || (payload.complete !== true && payload.skippedConversationIds !== undefined)
      || (payload.complete === true && (
        !Array.isArray(payload.skippedConversationIds)
        || payload.skippedConversationIds.length > 100
        || payload.skippedConversationIds.some(
          value => typeof value !== 'string' || !UUID.test(value),
        )
        || new Set(payload.skippedConversationIds).size
          !== payload.skippedConversationIds.length
      ))
    ))
  ) throw new InvalidHistoryTransfer()
  const records: ArchivedMessage[] = []
  let previousSequence = 0
  for (const value of payload.records) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InvalidHistoryTransfer()
    }
    const message = value as Record<string, unknown>
    const sequence = message.sequence
    const protocolVersion = message.protocolVersion
    const ciphertextBase64 = message.ciphertextBase64
    const deletionReason = message.deletionReason
    const deletedAt = message.deletedAt
    const cryptoGenerationId = message.cryptoGenerationId
    const cryptoEpoch = message.cryptoEpoch
    const localPlaintext = message.localPlaintext
    if (
      message.conversationId !== expected.conversationId
    ) throw new HistoryTransferBindingError()
    if (
      typeof message.messageId !== 'string' || !UUID.test(message.messageId)
      || typeof message.clientMessageId !== 'string' || !UUID.test(message.clientMessageId)
      || typeof message.senderUserId !== 'string' || !UUID.test(message.senderUserId)
      || typeof message.senderDeviceId !== 'string' || !UUID.test(message.senderDeviceId)
      || !Number.isSafeInteger(sequence)
      || Number(sequence) <= previousSequence
      || (protocolVersion !== 1 && protocolVersion !== 2)
      || typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt))
      || typeof message.expiresAt !== 'string' || !Number.isFinite(Date.parse(message.expiresAt))
      || (localPlaintext !== undefined && (
        typeof localPlaintext !== 'string'
        || localPlaintext.length === 0
        || localPlaintext.length > 32_000
      ))
      || (ciphertextBase64 !== null && (
        typeof ciphertextBase64 !== 'string'
        || ciphertextBase64.length === 0
        || ciphertextBase64.length > 48_000
        || !BASE64.test(ciphertextBase64)
      ))
      || (ciphertextBase64 === null) !== (deletedAt !== null)
      || (ciphertextBase64 === null) !== (deletionReason !== null)
      || (deletedAt !== null && (
        typeof deletedAt !== 'string' || !Number.isFinite(Date.parse(deletedAt))
      ))
      || (deletionReason !== null && deletionReason !== 'manual' && deletionReason !== 'expired')
      || (ciphertextBase64 === null && localPlaintext !== undefined)
      || (protocolVersion === 2) !== (
        typeof cryptoGenerationId === 'string'
        && cryptoGenerationId.length > 0
        && Number.isSafeInteger(cryptoEpoch)
        && Number(cryptoEpoch) > 0
      )
      || (protocolVersion === 1 && (cryptoGenerationId !== null || cryptoEpoch !== null))
    ) throw new InvalidHistoryTransfer()
    previousSequence = Number(sequence)
    records.push({
      messageId: message.messageId,
      clientMessageId: message.clientMessageId,
      conversationId: expected.conversationId,
      senderUserId: message.senderUserId,
      senderDeviceId: message.senderDeviceId,
      protocolVersion,
      cryptoGenerationId: cryptoGenerationId as string | null,
      cryptoEpoch: cryptoEpoch === null ? null : Number(cryptoEpoch),
      sequence: Number(sequence),
      createdAt: message.createdAt,
      expiresAt: message.expiresAt,
      ciphertextBase64: ciphertextBase64 as string | null,
      deletionReason: deletionReason as 'manual' | 'expired' | null,
      deletedAt: deletedAt as string | null,
      ...(typeof localPlaintext === 'string' ? { localPlaintext } : {}),
    })
  }
  return {
    records,
    complete: payload.version === 2 || payload.version === 3
      || (payload.version === 4 && payload.complete === true),
    skippedConversationIds: payload.version === 3
      ? payload.skippedConversationIds as string[]
      : payload.version === 4
        ? (payload.skippedConversationIds as string[] | undefined) ?? []
        : [],
  }
}

async function stableChunkId(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join('\u0000'))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = [...digest.slice(0, 16)].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class SynchronizeDeviceHistory {
  private readonly running = new Map<string, Promise<DeviceHistorySyncProgress>>()
  private readonly statuses = new Map<string, DeviceHistorySyncProgress>()
  private readonly listeners = new Set<StatusListener>()
  private readonly cancelled = new Set<string>()
  private readonly scheduled = new Set<string>()
  private readonly cancelling = new Map<string, Promise<void>>()
  private workQueue: Promise<void> = Promise.resolve()
  private importRevision = 0
  private recurring: ScheduledTask | null = null

  constructor(
    private readonly gateway: DevicePairingGateway,
    private readonly messaging: MessagingGateway,
    private readonly archive: MessageArchive,
    private readonly protection: ProtocolMessageProtection,
    private readonly jobs: DeviceHistorySyncJobStore,
    private readonly scheduler: Scheduler,
    private readonly attempts = 12,
    private readonly prepareTarget: TargetPreparer | null = null,
    private readonly classifyConversation: ConversationClassifier | null = null,
  ) {}

  queue(job: DeviceHistorySyncJob): void {
    for (const progress of this.current(job.ownerUserId, job.currentDeviceId)) {
      if (progress.targetDeviceId !== job.targetDeviceId || progress.pairingId === job.pairingId) {
        continue
      }
      this.cancelled.add(progress.pairingId)
      this.jobs.remove(progress.pairingId)
      this.removeStatus(progress.pairingId)
    }
    this.cancelled.delete(job.pairingId)
    const runnable = {
      ...job,
      automaticResumeBlocked: false,
      automaticResumeReason: undefined,
    }
    this.jobs.save(runnable)
    this.emit(this.initialProgress(runnable, 'queued'))
  }

  current(ownerUserId: string, currentDeviceId: string): readonly DeviceHistorySyncProgress[] {
    return [...this.statuses.values()].filter(progress => (
      progress.ownerUserId === ownerUserId && progress.currentDeviceId === currentDeviceId
    ))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  resume(ownerUserId: string, currentDeviceId: string): void {
    for (const job of this.jobs.load(ownerUserId, currentDeviceId)) {
      if (job.automaticResumeBlocked) {
        if (!this.statuses.has(job.pairingId)) {
          const reason = job.automaticResumeReason
          const waiting = reason === 'waiting_peer'
          let failure: DeviceHistorySyncFailure | null = waiting ? null : 'unknown'
          if (reason && reason !== 'waiting_peer') failure = reason
          this.emit({
            ...this.initialProgress(job, waiting ? 'waiting_peer' : 'failed'),
            failure,
          })
        }
        continue
      }
      this.schedule(job)
    }
  }

  retry(pairingId: string): void {
    const progress = this.statuses.get(pairingId)
    if (!progress || !['waiting_peer', 'failed'].includes(progress.stage)) return
    const job = this.jobs.load(progress.ownerUserId, progress.currentDeviceId)
      .find(item => item.pairingId === pairingId)
    if (!job) return
    const runnable = {
      ...job,
      automaticResumeBlocked: false,
      automaticResumeReason: undefined,
      cancelRequested: false,
    }
    this.cancelled.delete(pairingId)
    this.jobs.save(runnable)
    this.emit(this.initialProgress(runnable, 'queued'))
    this.schedule(runnable)
  }

  async cancel(pairingId: string): Promise<void> {
    const progress = this.statuses.get(pairingId)
    if (!progress || progress.complete) return
    const job = this.jobs.load(progress.ownerUserId, progress.currentDeviceId)
      .find(item => item.pairingId === pairingId)
    if (!job) {
      this.removeStatus(pairingId)
      return
    }
    const cancellingJob = { ...job, cancelRequested: true }
    this.cancelled.add(pairingId)
    this.jobs.save(cancellingJob)
    this.emit({ ...progress, stage: 'cancelling', failure: null, complete: false })
    await this.cancelJob(cancellingJob)
  }

  dismiss(pairingId: string): void {
    this.jobs.remove(pairingId)
    this.removeStatus(pairingId)
  }

  start(ownerUserId: string, currentDeviceId: string): void {
    this.stop()
    this.resume(ownerUserId, currentDeviceId)
    this.recurring = this.scheduler.repeat(
      30_000,
      () => this.resume(ownerUserId, currentDeviceId),
    )
  }

  stop(): void {
    this.recurring?.cancel()
    this.recurring = null
  }

  private schedule(job: DeviceHistorySyncJob): void {
    if (this.scheduled.has(job.pairingId)) return
    this.scheduled.add(job.pairingId)
    const operation = this.workQueue.then(async () => {
      if (job.cancelRequested) await this.cancelJob(job)
      else await this.retryJob(job)
    })
    this.workQueue = operation.catch(() => undefined)
    void operation.finally(() => this.scheduled.delete(job.pairingId)).catch(() => undefined)
  }

  private async retryJob(job: DeviceHistorySyncJob): Promise<void> {
    // Both peers share one public IP on the common home-Wi-Fi case. Let the QR
    // authorization/status burst drain before starting their history uploads.
    await new Promise<void>(resolve => this.scheduler.once(
      peerPollDelayMilliseconds(job.currentDeviceId),
      resolve,
    ))
    let lastFailure: DeviceHistorySyncFailure = 'unknown'
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      if (this.cancelled.has(job.pairingId)) return
      try {
        const progress = await this.synchronize(job)
        if (progress.complete) this.jobs.remove(job.pairingId)
        return
      } catch (error) {
        if (error instanceof DeviceHistorySyncCancelled || this.cancelled.has(job.pairingId)) {
          return
        }
        const outcome = failureFrom(error)
        lastFailure = outcome.failure
        const previous = this.statuses.get(job.pairingId) ?? this.initialProgress(job, 'retrying')
        if (outcome.terminal) {
          this.jobs.remove(job.pairingId)
          this.emit({
            ...previous,
            stage: outcome.failure === 'stopped' ? 'cancelled' : 'failed',
            failure: outcome.failure,
            complete: false,
          })
          return
        }
        this.emit({
          ...previous,
          stage: 'retrying',
          failure: outcome.failure,
          complete: false,
        })
        const delay = retryDelayMilliseconds(
          outcome.failure,
          attempt,
          job.currentDeviceId,
        )
        await new Promise<void>(resolve => this.scheduler.once(delay, resolve))
      }
    }
    const previous = this.statuses.get(job.pairingId)
      ?? this.initialProgress(job, 'failed')
    const latestJob = this.jobs.load(job.ownerUserId, job.currentDeviceId)
      .find(item => item.pairingId === job.pairingId) ?? job
    this.jobs.save({
      ...latestJob,
      automaticResumeBlocked: true,
      automaticResumeReason: lastFailure,
    })
    this.emit({
      ...previous,
      stage: 'failed',
      failure: lastFailure,
      complete: false,
    })
  }

  private cancelJob(job: DeviceHistorySyncJob): Promise<void> {
    const existing = this.cancelling.get(job.pairingId)
    if (existing) return existing
    const operation = (async () => {
      try {
        await this.gateway.cancelHistorySync(job.pairingId)
        this.jobs.remove(job.pairingId)
        const previous = this.statuses.get(job.pairingId)
          ?? this.initialProgress(job, 'cancelled')
        this.emit({ ...previous, stage: 'cancelled', failure: 'stopped', complete: false })
      } catch (error) {
        const outcome = failureFrom(error)
        if (outcome.terminal) {
          this.jobs.remove(job.pairingId)
          const previous = this.statuses.get(job.pairingId)
            ?? this.initialProgress(job, 'cancelled')
          this.emit({ ...previous, stage: 'cancelled', failure: 'stopped', complete: false })
          return
        }
        const previous = this.statuses.get(job.pairingId)
          ?? this.initialProgress(job, 'cancelling')
        this.emit({
          ...previous,
          stage: 'cancelling',
          failure: outcome.failure,
          complete: false,
        })
      }
    })()
    this.cancelling.set(job.pairingId, operation)
    void operation.finally(() => this.cancelling.delete(job.pairingId)).catch(() => undefined)
    return operation
  }

  synchronize(
    job: DeviceHistorySyncJob,
    onProgress: ProgressListener = () => undefined,
  ): Promise<DeviceHistorySyncProgress> {
    const existing = this.running.get(job.pairingId)
    if (existing) {
      const current = this.statuses.get(job.pairingId)
      if (current) onProgress(current)
      return existing
    }
    const operation = this.run(job, onProgress)
    this.running.set(job.pairingId, operation)
    void operation.finally(() => {
      if (this.running.get(job.pairingId) === operation) this.running.delete(job.pairingId)
    }).catch(() => undefined)
    return operation
  }

  private async run(
    job: DeviceHistorySyncJob,
    onProgress: ProgressListener,
  ): Promise<DeviceHistorySyncProgress> {
    this.ensureActive(job.pairingId)
    let progress = this.initialProgress(
      job,
      job.prepareTarget && this.prepareTarget ? 'preparing_crypto' : 'transferring',
    )
    const locallySkipped = new Set<string>()
    let preparationRelayChecked = false
    this.report(progress, onProgress)
    if (job.prepareTarget && this.prepareTarget) {
      const prepared = await this.prepareTarget(
        job.ownerUserId,
        job.targetDeviceId,
        state => {
          progress = {
            ...progress,
            stage: 'preparing_crypto',
            totalConversations: state.totalConversations,
            readyConversations: state.readyConversations,
            skippedConversations: state.skippedConversationIds?.length ?? 0,
            skippedConversationIds: [...(state.skippedConversationIds ?? [])],
          }
          this.report(progress, onProgress)
        },
        async () => {
          this.ensureActive(job.pairingId)
          if (preparationRelayChecked) return
          preparationRelayChecked = true
          await this.relayRequest(
            job.pairingId,
            () => this.gateway.listOutboundHistoryChunks(job.pairingId),
          )
        },
      )
      this.ensureActive(job.pairingId)
      progress = {
        ...progress,
        totalConversations: prepared.totalConversations,
        readyConversations: prepared.readyConversations,
        skippedConversations: prepared.skippedConversationIds?.length ?? 0,
        skippedConversationIds: [...(prepared.skippedConversationIds ?? [])],
      }
      for (const conversationId of prepared.skippedConversationIds ?? []) {
        locallySkipped.add(conversationId)
      }
      if (!prepared.complete) {
        this.report({ ...progress, stage: 'retrying' }, onProgress)
        throw new Error('target MLS enrollment is incomplete')
      }
    }
    const conversations = (await this.messaging.listConversations())
      .filter(item => item.conversationType === 'direct')
    this.ensureActive(job.pairingId)
    const conversationIds = new Set(conversations.map(item => item.conversationId))
    if ([...locallySkipped].some(id => !conversationIds.has(id))) {
      throw new Error('prepared history skip binding mismatch')
    }
    const pendingConversationIds: string[] = []
    if (this.classifyConversation) {
      for (const conversation of conversations) {
        if (locallySkipped.has(conversation.conversationId)) continue
        const state = await this.classifyConversation(
          conversation.conversationId,
          job.currentDeviceId,
          job.targetDeviceId,
        )
        this.ensureActive(job.pairingId)
        if (state === 'skipped') locallySkipped.add(conversation.conversationId)
        else if (state === 'pending') pendingConversationIds.push(conversation.conversationId)
      }
    }
    if (pendingConversationIds.length > 0) {
      throw new Error('conversation crypto selection is pending')
    }
    const transferableConversations = conversations.filter(
      conversation => !locallySkipped.has(conversation.conversationId),
    )
    progress = {
      ...progress,
      stage: 'transferring',
      totalConversations: conversations.length,
      readyConversations: transferableConversations.length,
      skippedConversations: locallySkipped.size,
      skippedConversationIds: [...locallySkipped],
    }
    this.report(progress, onProgress)
    if (conversations.length === 0 || transferableConversations.length === 0) {
      progress = {
        ...progress,
        stage: 'complete',
        confirmedConversations: conversations.length,
        complete: true,
      }
      this.jobs.remove(job.pairingId)
      this.report(progress, onProgress)
      return progress
    }
    const outbound = await this.relayRequest(
      job.pairingId,
      () => this.gateway.listOutboundHistoryChunks(job.pairingId),
    )
    const existingOutbound = new Set(outbound.map(chunk => chunk.clientChunkId))
    const completionIds = new Map<string, string>()
    const peerComplete = new Set(job.peerCompletedConversationIds ?? [])
    for (const conversation of transferableConversations) {
      this.ensureActive(job.pairingId)
      const records = await this.readTransferable(job.ownerUserId, conversation.conversationId)
      this.ensureActive(job.pairingId)
      progress = { ...progress, gaps: progress.gaps + records.gaps }
      const pages = packedRecordChunks(records.messages)
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex]!
        const first = page.at(0)
        const last = page.at(-1)
        if (!first || !last) continue
        const chunkId = await stableChunkId([
          job.pairingId,
          job.currentDeviceId,
          conversation.conversationId,
          first.messageId,
          last.messageId,
          'packed-v4',
        ])
        progress = { ...progress, exportedRecords: progress.exportedRecords + page.length }
        this.report(progress, onProgress)
        if (!existingOutbound.has(chunkId)) {
          const payload: HistoryTransferPayload = {
            type: 'yv-chat-device-history',
            version: 4,
            pairingId: job.pairingId,
            senderDeviceId: job.currentDeviceId,
            targetDeviceId: job.targetDeviceId,
            conversationId: conversation.conversationId,
            clientChunkId: chunkId,
            records: page,
          }
          const protectedChunk = await this.protection.protectText(2, {
            conversationId: conversation.conversationId,
            clientMessageId: chunkId,
            plaintext: JSON.stringify(payload),
          })
          this.ensureActive(job.pairingId)
          await this.relayRequest(
            job.pairingId,
            () => this.gateway.uploadHistoryChunk(
              job.pairingId,
              job.targetDeviceId,
              conversation.conversationId,
              chunkId,
              protectedChunk.ciphertextBase64,
            ),
          )
          existingOutbound.add(chunkId)
        }
      }
      const completionId = await stableChunkId([
        job.pairingId,
        job.currentDeviceId,
        conversation.conversationId,
        'history-complete-v3',
      ])
      completionIds.set(conversation.conversationId, completionId)
      if (!existingOutbound.has(completionId)) {
        const payload: HistoryTransferPayload = {
          type: 'yv-chat-device-history',
          version: 3,
          pairingId: job.pairingId,
          senderDeviceId: job.currentDeviceId,
          targetDeviceId: job.targetDeviceId,
          conversationId: conversation.conversationId,
          clientChunkId: completionId,
          records: [],
          complete: true,
          skippedConversationIds: [...locallySkipped],
        }
        const protectedChunk = await this.protection.protectText(2, {
          conversationId: conversation.conversationId,
          clientMessageId: completionId,
          plaintext: JSON.stringify(payload),
        })
        this.ensureActive(job.pairingId)
        await this.relayRequest(
          job.pairingId,
          () => this.gateway.uploadHistoryChunk(
            job.pairingId,
            job.targetDeviceId,
            conversation.conversationId,
            completionId,
            protectedChunk.ciphertextBase64,
          ),
        )
        existingOutbound.add(completionId)
      }
    }

    // Let the paced upload stream drain before both peers begin list/ACK polling.
    await new Promise<void>(resolve => this.scheduler.once(
      peerPollDelayMilliseconds(job.currentDeviceId),
      resolve,
    ))
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      this.ensureActive(job.pairingId)
      const incoming = await this.relayRequest(
        job.pairingId,
        () => this.gateway.listHistoryChunks(job.pairingId),
      )
      for (const chunk of incoming) {
        if (
          chunk.targetDeviceId !== job.currentDeviceId
          || chunk.senderDeviceId !== job.targetDeviceId
        ) throw new Error('history relay binding mismatch')
        if (locallySkipped.has(chunk.conversationId)) {
          peerComplete.add(chunk.conversationId)
          await this.relayRequest(
            job.pairingId,
            () => this.gateway.acknowledgeHistoryChunk(job.pairingId, chunk.chunkId),
          )
          progress = {
            ...progress,
            confirmedConversations: conversations.filter(
              conversation => peerComplete.has(conversation.conversationId),
            ).length,
          }
          this.report(progress, onProgress)
          continue
        }
        const expected = {
          type: 'yv-chat-device-history' as const,
          pairingId: job.pairingId,
          senderDeviceId: job.targetDeviceId,
          targetDeviceId: job.currentDeviceId,
          conversationId: chunk.conversationId,
          clientChunkId: chunk.clientChunkId,
        }
        let payload: ReturnType<typeof transferRecords>
        try {
          const content = await this.protection.unprotectText(2, {
            conversationId: chunk.conversationId,
            clientMessageId: chunk.clientChunkId,
            ciphertextBase64: chunk.ciphertextBase64,
          })
          this.ensureActive(job.pairingId)
          payload = transferRecords(JSON.parse(content.plaintext), expected)
        } catch (error) {
          if (
            error instanceof HistoryTransferBindingError
            || (error instanceof MessageProtectionError && error.kind !== 'corrupt-envelope')
          ) throw error
          if (!(error instanceof InvalidHistoryTransfer || error instanceof SyntaxError
            || error instanceof MessageProtectionError)) throw error
          locallySkipped.add(chunk.conversationId)
          peerComplete.add(chunk.conversationId)
          this.jobs.save({
            ...job,
            peerCompletedConversationIds: [...peerComplete],
          })
          await this.relayRequest(
            job.pairingId,
            () => this.gateway.acknowledgeHistoryChunk(job.pairingId, chunk.chunkId),
          )
          progress = {
            ...progress,
            confirmedConversations: conversations.filter(
              conversation => peerComplete.has(conversation.conversationId),
            ).length,
            skippedConversations: locallySkipped.size,
            skippedConversationIds: [...locallySkipped],
          }
          this.report(progress, onProgress)
          continue
        }
        if (payload.skippedConversationIds.some(id => !conversationIds.has(id))) {
          throw new Error('history skip manifest binding mismatch')
        }
        for (const conversationId of payload.skippedConversationIds) {
          locallySkipped.add(conversationId)
          peerComplete.add(conversationId)
        }
        if (payload.records.length > 0) {
          await this.archive.put(job.ownerUserId, chunk.conversationId, payload.records)
          this.ensureActive(job.pairingId)
        }
        if (payload.complete) {
          peerComplete.add(chunk.conversationId)
          this.ensureActive(job.pairingId)
          this.jobs.save({
            ...job,
            peerCompletedConversationIds: [...peerComplete],
          })
        }
        await this.relayRequest(
          job.pairingId,
          () => this.gateway.acknowledgeHistoryChunk(job.pairingId, chunk.chunkId),
        )
        progress = {
          ...progress,
          confirmedConversations: conversations.filter(
            conversation => peerComplete.has(conversation.conversationId),
          ).length,
          importedRecords: progress.importedRecords + payload.records.length,
          importRevision: payload.records.length > 0
            ? ++this.importRevision
            : progress.importRevision,
          importedConversationIds: payload.records.length > 0
            ? [...new Set([...progress.importedConversationIds, chunk.conversationId])]
            : progress.importedConversationIds,
          skippedConversations: locallySkipped.size,
          skippedConversationIds: [...locallySkipped],
        }
        this.report(progress, onProgress)
      }
      const latestOutbound = await this.relayRequest(
        job.pairingId,
        () => this.gateway.listOutboundHistoryChunks(job.pairingId),
      )
      const acknowledgedCompletionIds = new Set(
        latestOutbound
          .filter(chunk => chunk.acknowledgedAt !== null)
          .map(chunk => chunk.clientChunkId),
      )
      const localMarkersAcknowledged = [...completionIds.values()]
        .every(id => acknowledgedCompletionIds.has(id))
      const peerMarkersReceived = conversations.every(
        conversation => peerComplete.has(conversation.conversationId),
      )
      if (localMarkersAcknowledged && peerMarkersReceived) {
        progress = { ...progress, stage: 'complete', complete: true }
        this.jobs.remove(job.pairingId)
        this.report(progress, onProgress)
        return progress
      }
      progress = { ...progress, stage: attempt === 0 ? 'transferring' : 'waiting_peer' }
      this.report(progress, onProgress)
      await new Promise<void>(resolve => this.scheduler.once(
        peerPollDelayMilliseconds(job.currentDeviceId),
        resolve,
      ))
    }
    progress = { ...progress, stage: 'waiting_peer' }
    this.jobs.save({
      ...job,
      peerCompletedConversationIds: [...peerComplete],
      automaticResumeBlocked: true,
      automaticResumeReason: 'waiting_peer',
    })
    this.report(progress, onProgress)
    return progress
  }

  private initialProgress(
    job: DeviceHistorySyncJob,
    stage: DeviceHistorySyncStage,
  ): DeviceHistorySyncProgress {
    return {
      ownerUserId: job.ownerUserId,
      currentDeviceId: job.currentDeviceId,
      pairingId: job.pairingId,
      targetDeviceId: job.targetDeviceId,
      stage,
      totalConversations: 0,
      readyConversations: 0,
      confirmedConversations: 0,
      skippedConversations: 0,
      exportedRecords: 0,
      importedRecords: 0,
      importRevision: 0,
      gaps: 0,
      complete: false,
      failure: null,
      importedConversationIds: [],
      skippedConversationIds: [],
    }
  }

  private report(progress: DeviceHistorySyncProgress, listener: ProgressListener): void {
    this.ensureActive(progress.pairingId)
    this.emit(progress)
    listener(progress)
  }

  private emit(progress: DeviceHistorySyncProgress): void {
    this.statuses.set(progress.pairingId, progress)
    for (const listener of this.listeners) listener(progress)
  }

  private ensureActive(pairingId: string): void {
    if (this.cancelled.has(pairingId)) throw new DeviceHistorySyncCancelled()
  }

  private async relayRequest<T>(
    pairingId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.ensureActive(pairingId)
    await new Promise<void>(resolve => this.scheduler.once(RELAY_REQUEST_INTERVAL_MS, resolve))
    this.ensureActive(pairingId)
    const result = await operation()
    this.ensureActive(pairingId)
    return result
  }

  private removeStatus(pairingId: string): void {
    const previous = this.statuses.get(pairingId)
    this.statuses.delete(pairingId)
    if (previous) {
      for (const listener of this.listeners) listener(previous)
    }
  }

  private async readTransferable(
    ownerUserId: string,
    conversationId: string,
  ): Promise<{ messages: ArchivedMessage[], gaps: number }> {
    let page = await this.archive.loadLatest(ownerUserId, conversationId, 100)
    const messages = [...page]
    while (page.length === 100 && messages.length < MAX_TRANSFER_RECORDS) {
      const before = page.at(0)?.sequence
      if (!before) break
      page = await this.archive.loadBefore(ownerUserId, conversationId, before, 100)
      messages.unshift(...page)
    }
    const bounded = messages.slice(-MAX_TRANSFER_RECORDS)
    const recovered: ArchivedMessage[] = []
    for (const message of bounded) {
      if (message.ciphertextBase64 !== null && message.localPlaintext === undefined) {
        try {
          const content = await this.protection.unprotectText(message.protocolVersion, {
            conversationId,
            clientMessageId: message.clientMessageId,
            ciphertextBase64: message.ciphertextBase64,
          })
          const enriched = { ...message, localPlaintext: content.plaintext }
          await this.archive.put(ownerUserId, conversationId, [enriched])
          recovered.push(enriched)
          continue
        } catch {
          // The source cannot transfer plaintext it can no longer authenticate/decrypt.
        }
      }
      recovered.push(message)
    }
    const transferable = recovered.filter(message => (
      message.ciphertextBase64 === null || message.localPlaintext !== undefined
    ))
    return {
      messages: transferable,
      gaps: recovered.length - transferable.length,
    }
  }
}
