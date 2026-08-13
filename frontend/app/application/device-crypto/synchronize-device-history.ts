import type { ArchivedMessage, MessageArchive } from '../ports/message-archive'
import type { DeviceHistorySyncJob, DeviceHistorySyncJobStore } from '../ports/device-history-sync-jobs'
import type { DevicePairingGateway } from '../ports/device-pairing-gateway'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'
import type { ProtocolMessageProtection } from '../messaging/message-protection'

const CHUNK_RECORD_LIMIT = 20
const MAX_CHUNKS_PER_CONVERSATION = 20
const MAX_TRANSFER_RECORDS = CHUNK_RECORD_LIMIT * MAX_CHUNKS_PER_CONVERSATION
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface HistoryTransferPayload {
  type: 'yv-chat-device-history'
  version: 1
  pairingId: string
  senderDeviceId: string
  targetDeviceId: string
  conversationId: string
  clientChunkId: string
  records: ArchivedMessage[]
}

export interface DeviceHistorySyncProgress {
  exportedRecords: number
  importedRecords: number
  gaps: number
  complete: boolean
}

type ProgressListener = (progress: DeviceHistorySyncProgress) => void

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size))
  }
  return result
}

function transferRecords(value: unknown, expected: Omit<HistoryTransferPayload, 'records'>): ArchivedMessage[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
  const payload = value as Record<string, unknown>
  if (
    payload.type !== expected.type
    || payload.version !== 1
    || payload.pairingId !== expected.pairingId
    || payload.senderDeviceId !== expected.senderDeviceId
    || payload.targetDeviceId !== expected.targetDeviceId
    || payload.conversationId !== expected.conversationId
    || payload.clientChunkId !== expected.clientChunkId
    || !Array.isArray(payload.records)
    || payload.records.length === 0
    || payload.records.length > CHUNK_RECORD_LIMIT
  ) throw new Error()
  const records: ArchivedMessage[] = []
  let previousSequence = 0
  for (const value of payload.records) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
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
      || typeof message.messageId !== 'string' || !UUID.test(message.messageId)
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
    ) throw new Error()
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
  return records
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
  private recurring: ScheduledTask | null = null

  constructor(
    private readonly gateway: DevicePairingGateway,
    private readonly messaging: MessagingGateway,
    private readonly archive: MessageArchive,
    private readonly protection: ProtocolMessageProtection,
    private readonly jobs: DeviceHistorySyncJobStore,
    private readonly scheduler: Scheduler,
    private readonly attempts = 12,
  ) {}

  queue(job: DeviceHistorySyncJob): void {
    this.jobs.save(job)
  }

  resume(ownerUserId: string, currentDeviceId: string): void {
    for (const job of this.jobs.load(ownerUserId, currentDeviceId)) {
      void this.retryJob(job)
    }
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

  private async retryJob(job: DeviceHistorySyncJob): Promise<void> {
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        await this.synchronize(job)
        return
      } catch {
        await new Promise<void>(resolve => this.scheduler.once(1_500, resolve))
      }
    }
  }

  synchronize(
    job: DeviceHistorySyncJob,
    onProgress: ProgressListener = () => undefined,
  ): Promise<DeviceHistorySyncProgress> {
    const existing = this.running.get(job.pairingId)
    if (existing) return existing
    const operation = this.run(job, onProgress)
    this.running.set(job.pairingId, operation)
    void operation.finally(() => {
      if (this.running.get(job.pairingId) === operation) this.running.delete(job.pairingId)
    })
    return operation
  }

  private async run(
    job: DeviceHistorySyncJob,
    onProgress: ProgressListener,
  ): Promise<DeviceHistorySyncProgress> {
    let progress: DeviceHistorySyncProgress = {
      exportedRecords: 0,
      importedRecords: 0,
      gaps: 0,
      complete: false,
    }
    const conversations = (await this.messaging.listConversations())
      .filter(item => item.conversationType === 'direct')
    const existingOutbound = new Set(
      (await this.gateway.listOutboundHistoryChunks(job.pairingId))
        .map(chunk => chunk.clientChunkId),
    )
    for (const conversation of conversations) {
      const records = await this.readTransferable(job.ownerUserId, conversation.conversationId)
      progress = { ...progress, gaps: progress.gaps + records.gaps }
      const pages = chunks(records.messages, CHUNK_RECORD_LIMIT)
        .slice(-MAX_CHUNKS_PER_CONVERSATION)
      for (const page of pages) {
        const first = page.at(0)
        const last = page.at(-1)
        if (!first || !last) continue
        const chunkId = await stableChunkId([
          job.pairingId,
          job.currentDeviceId,
          conversation.conversationId,
          first.messageId,
          last.messageId,
        ])
        if (existingOutbound.has(chunkId)) continue
        const payload: HistoryTransferPayload = {
          type: 'yv-chat-device-history',
          version: 1,
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
        await this.gateway.uploadHistoryChunk(
          job.pairingId,
          job.targetDeviceId,
          conversation.conversationId,
          chunkId,
          protectedChunk.ciphertextBase64,
        )
        existingOutbound.add(chunkId)
        progress = { ...progress, exportedRecords: progress.exportedRecords + page.length }
        onProgress(progress)
      }
    }

    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      const incoming = await this.gateway.listHistoryChunks(job.pairingId)
      for (const chunk of incoming) {
        if (
          chunk.targetDeviceId !== job.currentDeviceId
          || chunk.senderDeviceId !== job.targetDeviceId
        ) throw new Error('history relay binding mismatch')
        const content = await this.protection.unprotectText(2, {
          conversationId: chunk.conversationId,
          clientMessageId: chunk.clientChunkId,
          ciphertextBase64: chunk.ciphertextBase64,
        })
        const expected = {
          type: 'yv-chat-device-history' as const,
          version: 1 as const,
          pairingId: job.pairingId,
          senderDeviceId: job.targetDeviceId,
          targetDeviceId: job.currentDeviceId,
          conversationId: chunk.conversationId,
          clientChunkId: chunk.clientChunkId,
        }
        const records = transferRecords(JSON.parse(content.plaintext), expected)
        await this.archive.put(job.ownerUserId, chunk.conversationId, records)
        await this.gateway.acknowledgeHistoryChunk(job.pairingId, chunk.chunkId)
        progress = { ...progress, importedRecords: progress.importedRecords + records.length }
        onProgress(progress)
      }
      if (incoming.length === 0 && attempt >= 2) {
        progress = { ...progress, complete: true }
        onProgress(progress)
        return progress
      }
      await new Promise<void>(resolve => this.scheduler.once(1_500, resolve))
    }
    return progress
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
