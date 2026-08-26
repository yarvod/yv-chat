import { describe, expect, it, vi } from 'vitest'

import { SynchronizeDeviceHistory } from '../app/application/device-crypto/synchronize-device-history'
import { ApplicationError } from '../app/application/errors'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import type { DeviceHistorySyncJob, DeviceHistorySyncJobStore } from '../app/application/ports/device-history-sync-jobs'
import type { DevicePairingGateway } from '../app/application/ports/device-pairing-gateway'
import type { MessageArchive, ArchivedMessage } from '../app/application/ports/message-archive'
import type { MessageProtocolAdapter } from '../app/application/ports/message-protocol-adapter'
import type { Scheduler, ScheduledTask } from '../app/application/ports/scheduler'
import type { DeviceHistoryRelayChunk } from '../app/domain/accounts/device-pairing'
import { BrowserDeviceHistorySyncJobStore } from '../app/infrastructure/storage/browser-device-history-sync-jobs'

const owner = '11111111-1111-4111-8111-111111111111'
const trusted = '22222222-2222-4222-8222-222222222222'
const candidate = '33333333-3333-4333-8333-333333333333'
const pairing = '44444444-4444-4444-8444-444444444444'
const conversation = '55555555-5555-4555-8555-555555555555'
const blockedConversation = '55555555-5555-4555-8555-555555555556'

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decode(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))
}

class MemoryArchive implements MessageArchive {
  readonly records = new Map<number, ArchivedMessage>()

  constructor(messages: readonly ArchivedMessage[]) {
    for (const message of messages) this.records.set(message.sequence, message)
  }

  async loadLatest(_owner: string, _conversation: string, limit: number) {
    return [...this.records.values()].sort((a, b) => a.sequence - b.sequence).slice(-limit)
  }

  async loadBefore(_owner: string, _conversation: string, before: number, limit: number) {
    return [...this.records.values()]
      .filter(message => message.sequence < before)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(-limit)
  }

  async loadAfter(_owner: string, _conversation: string, after: number, limit: number) {
    return [...this.records.values()]
      .filter(message => message.sequence > after)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
  }

  async put(_owner: string, _conversation: string, messages: readonly ArchivedMessage[]) {
    for (const message of messages) {
      const existing = this.records.get(message.sequence)
      if (existing && existing.messageId !== message.messageId) throw new Error('conflict')
      this.records.set(message.sequence, { ...existing, ...message })
    }
  }

  close() {}
}

class PartitionedMemoryArchive implements MessageArchive {
  private readonly conversations = new Map<string, Map<number, ArchivedMessage>>()

  constructor(messages: readonly ArchivedMessage[]) {
    for (const message of messages) this.bucket(message.conversationId).set(message.sequence, message)
  }

  async loadLatest(_owner: string, conversationId: string, limit: number) {
    return this.sorted(conversationId).slice(-limit)
  }

  async loadBefore(_owner: string, conversationId: string, before: number, limit: number) {
    return this.sorted(conversationId)
      .filter(message => message.sequence < before)
      .slice(-limit)
  }

  async loadAfter(_owner: string, conversationId: string, after: number, limit: number) {
    return this.sorted(conversationId)
      .filter(message => message.sequence > after)
      .slice(0, limit)
  }

  async put(_owner: string, conversationId: string, messages: readonly ArchivedMessage[]) {
    const bucket = this.bucket(conversationId)
    for (const message of messages) {
      const existing = bucket.get(message.sequence)
      if (existing && existing.messageId !== message.messageId) throw new Error('conflict')
      bucket.set(message.sequence, { ...existing, ...message })
    }
  }

  count(): number {
    return [...this.conversations.values()]
      .reduce((total, messages) => total + messages.size, 0)
  }

  countConversation(conversationId: string): number {
    return this.bucket(conversationId).size
  }

  close() {}

  private bucket(conversationId: string): Map<number, ArchivedMessage> {
    let bucket = this.conversations.get(conversationId)
    if (!bucket) {
      bucket = new Map()
      this.conversations.set(conversationId, bucket)
    }
    return bucket
  }

  private sorted(conversationId: string): ArchivedMessage[] {
    return [...this.bucket(conversationId).values()].sort((a, b) => a.sequence - b.sequence)
  }
}

class MemoryJobs implements DeviceHistorySyncJobStore {
  readonly jobs = new Map<string, DeviceHistorySyncJob>()
  save(job: DeviceHistorySyncJob) { this.jobs.set(job.pairingId, job) }
  load(ownerUserId: string, currentDeviceId: string) {
    return [...this.jobs.values()].filter(job => (
      job.ownerUserId === ownerUserId && job.currentDeviceId === currentDeviceId
    ))
  }
  remove(pairingId: string) { this.jobs.delete(pairingId) }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

interface RelayState {
  chunks: DeviceHistoryRelayChunk[]
  acknowledged: Set<string>
}

class RelayGateway {
  constructor(private readonly state: RelayState, private readonly currentDeviceId: string) {}

  async uploadHistoryChunk(
    _pairingId: string,
    targetDeviceId: string,
    conversationId: string,
    clientChunkId: string,
    ciphertextBase64: string,
  ): Promise<DeviceHistoryRelayChunk> {
    const existing = this.state.chunks.find(chunk => (
      chunk.senderDeviceId === this.currentDeviceId && chunk.clientChunkId === clientChunkId
    ))
    if (existing) return existing
    const sequence = this.state.chunks.length + 1
    const chunk: DeviceHistoryRelayChunk = {
      chunkId: `66666666-6666-4666-8666-${String(sequence).padStart(12, '0')}`,
      serverSequence: sequence,
      senderDeviceId: this.currentDeviceId,
      targetDeviceId,
      conversationId,
      clientChunkId,
      ciphertextBase64,
      createdAt: '2026-08-13T12:00:00Z',
      expiresAt: '2026-08-14T12:00:00Z',
      acknowledgedAt: null,
    }
    this.state.chunks.push(chunk)
    return chunk
  }

  async listHistoryChunks() {
    return this.state.chunks.filter(chunk => (
      chunk.targetDeviceId === this.currentDeviceId
      && !this.state.acknowledged.has(chunk.chunkId)
    ))
  }

  async listOutboundHistoryChunks() {
    return this.state.chunks.filter(chunk => chunk.senderDeviceId === this.currentDeviceId)
  }

  async acknowledgeHistoryChunk(_pairingId: string, chunkId: string) {
    this.state.acknowledged.add(chunkId)
    const chunk = this.state.chunks.find(item => item.chunkId === chunkId)
    if (chunk) chunk.acknowledgedAt = '2026-08-13T12:01:00Z'
  }
}

const adapter: MessageProtocolAdapter = {
  protocolVersion: 2,
  secure: true,
  label: 'test MLS',
  async protectText(input) {
    return {
      ciphertextBase64: encode(input.plaintext),
      cryptoGenerationId: '77777777-7777-4777-8777-777777777777',
      cryptoEpoch: 2,
    }
  },
  async unprotectText(input) { return decode(input.ciphertextBase64) },
}

const scheduler: Scheduler = {
  once(_delay, callback): ScheduledTask {
    const timer = setTimeout(callback, 0)
    return { cancel() { clearTimeout(timer) } }
  },
  repeat(): ScheduledTask { return { cancel() {} } },
}

function archived(sequence: number, deviceId: string, text: string): ArchivedMessage {
  return {
    messageId: `${sequence === 1 ? '88888888' : '99999999'}-8888-4888-8888-888888888888`,
    clientMessageId: `${sequence === 1 ? 'aaaaaaaa' : 'bbbbbbbb'}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    conversationId: conversation,
    senderUserId: owner,
    senderDeviceId: deviceId,
    protocolVersion: 2,
    cryptoGenerationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    cryptoEpoch: 1,
    sequence,
    createdAt: `2026-08-13T12:00:0${sequence}Z`,
    expiresAt: '2026-09-12T12:00:00Z',
    ciphertextBase64: encode(`opaque-${sequence}`),
    deletionReason: null,
    deletedAt: null,
    localPlaintext: text,
  }
}

function stressArchived(
  conversationId: string,
  sequence: number,
  globalIndex: number,
  deviceId: string,
): ArchivedMessage {
  const suffix = String(globalIndex).padStart(12, '0')
  const clientSuffix = String(100_000 + globalIndex).padStart(12, '0')
  return {
    messageId: `88888888-8888-4888-8888-${suffix}`,
    clientMessageId: `aaaaaaaa-aaaa-4aaa-8aaa-${clientSuffix}`,
    conversationId,
    senderUserId: owner,
    senderDeviceId: deviceId,
    protocolVersion: 2,
    cryptoGenerationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    cryptoEpoch: 1,
    sequence,
    createdAt: new Date(Date.UTC(2026, 7, 13, 12, 0, globalIndex)).toISOString(),
    expiresAt: '2026-09-12T12:00:00Z',
    ciphertextBase64: encode(`opaque-${globalIndex}`),
    deletionReason: null,
    deletedAt: null,
    localPlaintext: `message-${globalIndex}`,
  }
}

function service(
  currentDeviceId: string,
  archive: MessageArchive,
  relay: RelayState,
  jobs: DeviceHistorySyncJobStore,
  prepareTarget: ConstructorParameters<typeof SynchronizeDeviceHistory>[7] = null,
  classifyConversation: ConstructorParameters<typeof SynchronizeDeviceHistory>[8] = null,
  conversationIds: readonly string[] = [conversation],
) {
  return new SynchronizeDeviceHistory(
    new RelayGateway(relay, currentDeviceId) as unknown as DevicePairingGateway,
    {
      listConversations: async () => conversationIds.map(conversationId => ({
        conversationId,
        conversationType: 'direct' as const,
        title: null,
        createdBy: owner,
        createdAt: '2026-08-13T12:00:00Z',
        updatedAt: '2026-08-13T12:00:00Z',
        members: [],
      })),
    } as never,
    archive,
    new ProtocolMessageProtection([adapter]),
    jobs,
    scheduler,
    4,
    prepareTarget,
    classifyConversation,
  )
}

describe('QR-linked bidirectional device history sync', () => {
  it('collapses legacy jobs for the same local/target pair to the newest QR attempt', () => {
    const storage = new MemoryStorage()
    const oldest = '44444444-4444-4444-8444-444444444441'
    const newest = '44444444-4444-4444-8444-444444444443'
    storage.setItem('yv-chat-device-history-sync-jobs-v1', JSON.stringify([
      {
        ownerUserId: owner, currentDeviceId: trusted, targetDeviceId: candidate,
        pairingId: oldest, expiresAt: '2099-08-14T12:00:00Z',
      },
      {
        ownerUserId: owner, currentDeviceId: trusted, targetDeviceId: candidate,
        pairingId: '44444444-4444-4444-8444-444444444442',
        expiresAt: '2099-08-14T12:01:00Z',
      },
      {
        ownerUserId: owner, currentDeviceId: trusted, targetDeviceId: candidate,
        pairingId: newest, expiresAt: '2099-08-14T12:02:00Z',
        automaticResumeBlocked: true,
        automaticResumeReason: 'waiting_peer',
      },
    ]))

    const jobs = new BrowserDeviceHistorySyncJobStore(storage)

    expect(jobs.load(owner, trusted).map(job => job.pairingId)).toEqual([newest])
    expect(jobs.load(owner, trusted).at(0)?.automaticResumeBlocked).toBe(true)
    expect(jobs.load(owner, trusted).at(0)?.automaticResumeReason).toBe('waiting_peer')
    expect(JSON.parse(storage.getItem('yv-chat-device-history-sync-jobs-v1')!)).toHaveLength(1)
  })

  it('restores a blocked durable job as visible paused status without running it', async () => {
    const jobs = new MemoryJobs()
    jobs.save({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
      automaticResumeBlocked: true,
      automaticResumeReason: 'waiting_peer',
    })
    const listConversations = vi.fn()
    const sync = new SynchronizeDeviceHistory(
      {} as DevicePairingGateway,
      { listConversations } as never,
      new MemoryArchive([]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      scheduler,
    )

    sync.resume(owner, trusted)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(listConversations).not.toHaveBeenCalled()
    expect(sync.current(owner, trusted).at(0)).toMatchObject({
      stage: 'waiting_peer',
      failure: null,
      complete: false,
    })
  })

  it('runs restored jobs serially instead of creating concurrent MLS/history pipelines', async () => {
    const jobs = new MemoryJobs()
    const secondTarget = '33333333-3333-4333-8333-333333333334'
    for (const [pairingId, targetDeviceId] of [
      [pairing, candidate],
      ['44444444-4444-4444-8444-444444444445', secondTarget],
    ]) {
      jobs.save({
        ownerUserId: owner,
        currentDeviceId: trusted,
        pairingId,
        targetDeviceId,
        expiresAt: '2099-08-14T12:00:00Z',
      })
    }
    let active = 0
    let maximum = 0
    const sync = new SynchronizeDeviceHistory(
      {} as DevicePairingGateway,
      {
        async listConversations() {
          active += 1
          maximum = Math.max(maximum, active)
          await new Promise(resolve => setTimeout(resolve, 5))
          active -= 1
          return []
        },
      } as never,
      new MemoryArchive([]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      scheduler,
    )

    sync.resume(owner, trusted)

    await vi.waitFor(() => expect(jobs.jobs.size).toBe(0))
    expect(maximum).toBe(1)
  })

  it('persists a cancel intent until the server confirms it for both devices', async () => {
    const jobs = new MemoryJobs()
    const cancelHistorySync = vi.fn()
      .mockRejectedValueOnce(new ApplicationError(null, 'network', 'offline'))
      .mockResolvedValueOnce(undefined)
    const sync = new SynchronizeDeviceHistory(
      { cancelHistorySync } as unknown as DevicePairingGateway,
      {} as never,
      new MemoryArchive([]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      scheduler,
    )
    const job = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    }
    sync.queue(job)

    await sync.cancel(pairing)

    expect(jobs.load(owner, trusted).at(0)?.cancelRequested).toBe(true)
    expect(sync.current(owner, trusted).at(0)?.stage).toBe('cancelling')
    sync.resume(owner, trusted)
    await vi.waitFor(() => expect(jobs.jobs.size).toBe(0))
    expect(sync.current(owner, trusted).at(0)?.stage).toBe('cancelled')
    expect(cancelHistorySync).toHaveBeenCalledTimes(2)
  })

  it('keeps the durable job and retries the same pairing after an HTTP 429', async () => {
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const jobs = new MemoryJobs()
    const delays: number[] = []
    const retryScheduler: Scheduler = {
      once(delay, callback): ScheduledTask {
        delays.push(delay)
        const timer = setTimeout(callback, 0)
        return { cancel() { clearTimeout(timer) } }
      },
      repeat(): ScheduledTask { return { cancel() {} } },
    }
    const gateway = new RelayGateway(relay, trusted)
    const outbound = vi.spyOn(gateway, 'listOutboundHistoryChunks')
      .mockRejectedValueOnce(new ApplicationError(429, 'http', 'rate limited'))
    const observed: string[] = []
    const sync = new SynchronizeDeviceHistory(
      gateway as unknown as DevicePairingGateway,
      {
        listConversations: async () => [{
          conversationId: conversation,
          conversationType: 'direct' as const,
          title: null,
          createdBy: owner,
          createdAt: '2026-08-13T12:00:00Z',
          updatedAt: '2026-08-13T12:00:00Z',
          members: [],
        }],
      } as never,
      new MemoryArchive([archived(1, trusted, 'trusted copy')]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      retryScheduler,
      2,
    )
    const job = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    }
    sync.subscribe(progress => {
      if (progress.failure) observed.push(progress.failure)
    })
    sync.queue(job)

    sync.resume(owner, trusted)

    await vi.waitFor(() => expect(
      sync.current(owner, trusted).at(0)?.stage,
    ).toBe('waiting_peer'))
    expect(observed).toContain('rate_limited')
    expect(delays.some(delay => delay >= 5_000)).toBe(true)
    expect(outbound).toHaveBeenCalledTimes(4)
    expect(jobs.load(owner, trusted)).toEqual([{
      ...job,
      peerCompletedConversationIds: [],
      automaticResumeBlocked: true,
      automaticResumeReason: 'waiting_peer',
    }])
    expect(sync.current(owner, trusted).at(0)).toMatchObject({
      stage: 'waiting_peer',
      failure: null,
      complete: false,
    })
    expect(delays.some(delay => delay >= 4_000 && delay < 6_000)).toBe(true)

    sync.resume(owner, trusted)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(outbound).toHaveBeenCalledTimes(4)
  })

  it('stops exhausted retryable failures until an explicit retry', async () => {
    const jobs = new MemoryJobs()
    const listConversations = vi.fn().mockRejectedValue(
      new ApplicationError(null, 'network', 'offline'),
    )
    const sync = new SynchronizeDeviceHistory(
      {} as DevicePairingGateway,
      { listConversations } as never,
      new MemoryArchive([]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      scheduler,
      2,
    )
    const job = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    }
    sync.queue(job)
    sync.resume(owner, trusted)

    await vi.waitFor(() => expect(sync.current(owner, trusted).at(0)?.stage).toBe('failed'))
    expect(listConversations).toHaveBeenCalledTimes(2)
    expect(jobs.load(owner, trusted).at(0)?.automaticResumeBlocked).toBe(true)
    expect(jobs.load(owner, trusted).at(0)?.automaticResumeReason).toBe('network')

    sync.resume(owner, trusted)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(listConversations).toHaveBeenCalledTimes(2)

    sync.retry(pairing)
    await vi.waitFor(() => expect(listConversations).toHaveBeenCalledTimes(4))
    expect(sync.current(owner, trusted).at(0)?.stage).toBe('failed')
  })

  it('paces symmetric peer polling below the shared production per-IP budget', async () => {
    const delays: number[] = []
    const pacedScheduler: Scheduler = {
      once(delay, callback): ScheduledTask {
        delays.push(delay)
        const timer = setTimeout(callback, 0)
        return { cancel() { clearTimeout(timer) } }
      },
      repeat(): ScheduledTask { return { cancel() {} } },
    }
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const sync = new SynchronizeDeviceHistory(
      new RelayGateway(relay, trusted) as unknown as DevicePairingGateway,
      {
        listConversations: async () => [{
          conversationId: conversation,
          conversationType: 'direct' as const,
          title: null,
          createdBy: owner,
          createdAt: '2026-08-13T12:00:00Z',
          updatedAt: '2026-08-13T12:00:00Z',
          members: [],
        }],
      } as never,
      new MemoryArchive([archived(1, trusted, 'trusted copy')]),
      new ProtocolMessageProtection([adapter]),
      new MemoryJobs(),
      pacedScheduler,
      2,
    )

    const result = await sync.synchronize({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    })

    expect(result.stage).toBe('waiting_peer')
    expect(delays).toHaveLength(3)
    expect(delays.every(delay => delay >= 4_000 && delay < 6_000)).toBe(true)
  })

  it('prepares the exact target MLS leaf before a trusted device exports history', async () => {
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const prepareTarget = vi.fn(async (_owner, _target, onProgress) => {
      onProgress({ totalConversations: 1, readyConversations: 1 })
      return { complete: true, totalConversations: 1, readyConversations: 1 }
    })
    const sync = service(
      trusted,
      new MemoryArchive([archived(1, trusted, 'trusted copy')]),
      relay,
      new MemoryJobs(),
      prepareTarget,
    )

    const result = await sync.synchronize({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
      prepareTarget: true,
      peerCompletedConversationIds: [],
    })

    expect(prepareTarget).toHaveBeenCalledWith(
      owner,
      candidate,
      expect.any(Function),
      expect.any(Function),
    )
    expect(relay.chunks).toHaveLength(2)
    expect(result.stage).toBe('waiting_peer')
  })

  it('stops trusted-device MLS preparation when the peer cancels the relay', async () => {
    const jobs = new MemoryJobs()
    const prepareTarget: ConstructorParameters<typeof SynchronizeDeviceHistory>[7]
      = vi.fn(async (_owner, _target, _onProgress, ensureActive) => {
        await ensureActive()
        return { complete: true, totalConversations: 1, readyConversations: 1 }
      })
    const sync = new SynchronizeDeviceHistory(
      {
        listOutboundHistoryChunks: vi.fn().mockRejectedValue(
          new ApplicationError(410, 'http', 'history sync was cancelled'),
        ),
      } as unknown as DevicePairingGateway,
      { listConversations: vi.fn() } as never,
      new MemoryArchive([]),
      new ProtocolMessageProtection([adapter]),
      jobs,
      scheduler,
      1,
      prepareTarget,
    )
    const job = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
      prepareTarget: true,
    }
    sync.queue(job)

    sync.resume(owner, trusted)

    await vi.waitFor(() => expect(jobs.jobs.size).toBe(0))
    expect(sync.current(owner, trusted).at(0)).toMatchObject({
      stage: 'cancelled',
      failure: 'stopped',
      complete: false,
    })
    expect(prepareTarget).toHaveBeenCalledOnce()
  })

  it('completes the available conversation and reports a missing-identity chat as skipped', async () => {
    const trustedArchive = new MemoryArchive([archived(1, trusted, 'from phone')])
    const candidateArchive = new MemoryArchive([archived(2, candidate, 'from mac')])
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const trustedJobs = new MemoryJobs()
    const candidateJobs = new MemoryJobs()
    const classify: ConstructorParameters<typeof SynchronizeDeviceHistory>[8]
      = vi.fn(async conversationId => (
        conversationId === blockedConversation ? 'skipped' : 'ready'
      ))
    const prepareTarget: ConstructorParameters<typeof SynchronizeDeviceHistory>[7]
      = vi.fn(async (_owner, _target, onProgress) => {
        onProgress({ totalConversations: 2, readyConversations: 1 })
        return {
          complete: true,
          totalConversations: 2,
          readyConversations: 1,
          skippedConversationIds: [blockedConversation],
        }
      })
    const conversations = [conversation, blockedConversation]
    const trustedService = service(
      trusted,
      trustedArchive,
      relay,
      trustedJobs,
      prepareTarget,
      classify,
      conversations,
    )
    const candidateService = service(
      candidate,
      candidateArchive,
      relay,
      candidateJobs,
      null,
      classify,
      conversations,
    )
    const expiresAt = '2099-08-14T12:00:00Z'
    const trustedInput = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt,
      prepareTarget: true,
    }
    const candidateInput = {
      ...trustedInput,
      currentDeviceId: candidate,
      targetDeviceId: trusted,
      prepareTarget: false,
    }

    const [firstTrusted, firstCandidate] = await Promise.all([
      trustedService.synchronize(trustedInput),
      candidateService.synchronize(candidateInput),
    ])
    const finalTrusted = firstTrusted.complete
      ? firstTrusted
      : await trustedService.synchronize(trustedInput)
    const finalCandidate = firstCandidate.complete
      ? firstCandidate
      : await candidateService.synchronize(candidateInput)

    expect(finalTrusted).toMatchObject({
      complete: true,
      totalConversations: 2,
      readyConversations: 1,
      confirmedConversations: 2,
      skippedConversations: 1,
      skippedConversationIds: [blockedConversation],
    })
    expect(finalCandidate).toMatchObject({
      complete: true,
      totalConversations: 2,
      readyConversations: 1,
      confirmedConversations: 2,
      skippedConversations: 1,
      skippedConversationIds: [blockedConversation],
    })
    expect(relay.chunks.every(chunk => chunk.conversationId === conversation)).toBe(true)
    expect(relay.acknowledged.size).toBe(relay.chunks.length)
  })

  it('does not silently skip a conversation whose crypto state is still pending', async () => {
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const classify: ConstructorParameters<typeof SynchronizeDeviceHistory>[8]
      = vi.fn().mockResolvedValue('pending')
    const sync = service(
      trusted,
      new MemoryArchive([archived(1, trusted, 'trusted copy')]),
      relay,
      new MemoryJobs(),
      null,
      classify,
    )

    await expect(sync.synchronize({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    })).rejects.toThrow('conversation crypto selection is pending')
    expect(relay.chunks).toHaveLength(0)
  })

  it('quarantines an unreadable conversation and continues importing peer markers', async () => {
    const validChunkId = '66666666-6666-4666-8666-666666666661'
    const brokenChunkId = '66666666-6666-4666-8666-666666666662'
    const relay: RelayState = {
      acknowledged: new Set(),
      chunks: [
        {
          chunkId: validChunkId,
          serverSequence: 1,
          senderDeviceId: candidate,
          targetDeviceId: trusted,
          conversationId: conversation,
          clientChunkId: validChunkId,
          ciphertextBase64: encode(JSON.stringify({
            type: 'yv-chat-device-history',
            version: 3,
            pairingId: pairing,
            senderDeviceId: candidate,
            targetDeviceId: trusted,
            conversationId: conversation,
            clientChunkId: validChunkId,
            records: [],
            complete: true,
            skippedConversationIds: [],
          })),
          createdAt: '2026-08-13T12:00:00Z',
          expiresAt: '2026-08-14T12:00:00Z',
          acknowledgedAt: null,
        },
        {
          chunkId: brokenChunkId,
          serverSequence: 2,
          senderDeviceId: candidate,
          targetDeviceId: trusted,
          conversationId: blockedConversation,
          clientChunkId: brokenChunkId,
          ciphertextBase64: encode('{broken-json'),
          createdAt: '2026-08-13T12:00:00Z',
          expiresAt: '2026-08-14T12:00:00Z',
          acknowledgedAt: null,
        },
      ],
    }
    const result = await service(
      trusted,
      new MemoryArchive([]),
      relay,
      new MemoryJobs(),
      null,
      null,
      [conversation, blockedConversation],
    ).synchronize({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    })

    expect(result).toMatchObject({
      confirmedConversations: 2,
      skippedConversations: 1,
      skippedConversationIds: [blockedConversation],
    })
    expect(relay.acknowledged).toEqual(new Set([validChunkId, brokenChunkId]))
  })

  it('does not quarantine a decrypted relay payload with a mismatched pairing binding', async () => {
    const chunkId = '66666666-6666-4666-8666-666666666663'
    const relay: RelayState = {
      acknowledged: new Set(),
      chunks: [{
        chunkId,
        serverSequence: 1,
        senderDeviceId: candidate,
        targetDeviceId: trusted,
        conversationId: conversation,
        clientChunkId: chunkId,
        ciphertextBase64: encode(JSON.stringify({
          type: 'yv-chat-device-history',
          version: 3,
          pairingId: '44444444-4444-4444-8444-444444444499',
          senderDeviceId: candidate,
          targetDeviceId: trusted,
          conversationId: conversation,
          clientChunkId: chunkId,
          records: [],
          complete: true,
          skippedConversationIds: [],
        })),
        createdAt: '2026-08-13T12:00:00Z',
        expiresAt: '2026-08-14T12:00:00Z',
        acknowledgedAt: null,
      }],
    }

    await expect(service(
      trusted,
      new MemoryArchive([]),
      relay,
      new MemoryJobs(),
    ).synchronize({
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt: '2099-08-14T12:00:00Z',
    })).rejects.toThrow()
    expect(relay.acknowledged).toEqual(new Set())
  })

  it('merges independently available sent history without overwriting either side', async () => {
    const trustedArchive = new MemoryArchive([archived(1, trusted, 'from phone')])
    const candidateArchive = new MemoryArchive([archived(2, candidate, 'from mac')])
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const trustedJob = new MemoryJobs()
    const candidateJob = new MemoryJobs()
    const expiresAt = '2099-08-14T12:00:00Z'

    const [trustedProgress, candidateProgress] = await Promise.all([
      service(trusted, trustedArchive, relay, trustedJob).synchronize({
        ownerUserId: owner,
        currentDeviceId: trusted,
        pairingId: pairing,
        targetDeviceId: candidate,
        expiresAt,
      }),
      service(candidate, candidateArchive, relay, candidateJob).synchronize({
        ownerUserId: owner,
        currentDeviceId: candidate,
        pairingId: pairing,
        targetDeviceId: trusted,
        expiresAt,
      }),
    ])

    expect([...trustedArchive.records.values()].sort((a, b) => a.sequence - b.sequence)
      .map(item => item.localPlaintext)).toEqual([
      'from phone',
      'from mac',
    ])
    expect([...candidateArchive.records.values()].sort((a, b) => a.sequence - b.sequence)
      .map(item => item.localPlaintext)).toEqual([
      'from phone',
      'from mac',
    ])
    expect(trustedProgress.complete).toBe(true)
    expect(candidateProgress.complete).toBe(true)
    expect(relay.acknowledged.size).toBe(4)
  })

  it('converges 1000 mixed records through direct relay plus authoritative group history', async () => {
    const directIds = [
      '55555555-5555-4555-8555-555555555551',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555553',
      '55555555-5555-4555-8555-555555555554',
    ]
    const groupIds = [
      '55555555-5555-4555-8555-555555555561',
      '55555555-5555-4555-8555-555555555562',
    ]
    const sourceRecords: ArchivedMessage[] = []
    let globalIndex = 0
    for (const conversationId of directIds) {
      for (let sequence = 1; sequence <= 150; sequence += 1) {
        globalIndex += 1
        sourceRecords.push(stressArchived(
          conversationId,
          sequence,
          globalIndex,
          trusted,
        ))
      }
    }
    const authoritativeGroups: ArchivedMessage[] = []
    for (const conversationId of groupIds) {
      for (let sequence = 1; sequence <= 200; sequence += 1) {
        globalIndex += 1
        authoritativeGroups.push(stressArchived(
          conversationId,
          sequence,
          globalIndex,
          trusted,
        ))
      }
    }
    sourceRecords.push(...authoritativeGroups)
    expect(sourceRecords).toHaveLength(1_000)

    const trustedArchive = new PartitionedMemoryArchive(sourceRecords)
    // Group v1 history is fetched from PostgreSQL via the normal history API,
    // not copied through the direct MLS relay. Model that authoritative fetch
    // before starting the peer union.
    const candidateArchive = new PartitionedMemoryArchive(authoritativeGroups)
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const stressScheduler: Scheduler = {
      once(_delay, callback): ScheduledTask {
        const timer = setTimeout(callback, 1)
        return { cancel() { clearTimeout(timer) } }
      },
      repeat(): ScheduledTask { return { cancel() {} } },
    }
    const conversations = [
      ...directIds.map(conversationId => ({ conversationId, conversationType: 'direct' as const })),
      ...groupIds.map(conversationId => ({ conversationId, conversationType: 'group' as const })),
    ].map(item => ({
      ...item,
      title: null,
      createdBy: owner,
      createdAt: '2026-08-13T12:00:00Z',
      updatedAt: '2026-08-13T12:00:00Z',
      members: [],
    }))
    const messaging = { listConversations: async () => conversations } as never
    const trustedSync = new SynchronizeDeviceHistory(
      new RelayGateway(relay, trusted) as unknown as DevicePairingGateway,
      messaging,
      trustedArchive,
      new ProtocolMessageProtection([adapter]),
      new MemoryJobs(),
      stressScheduler,
      100,
    )
    const candidateSync = new SynchronizeDeviceHistory(
      new RelayGateway(relay, candidate) as unknown as DevicePairingGateway,
      messaging,
      candidateArchive,
      new ProtocolMessageProtection([adapter]),
      new MemoryJobs(),
      stressScheduler,
      100,
    )
    const expiresAt = '2099-08-14T12:00:00Z'

    const [trustedProgress, candidateProgress] = await Promise.all([
      trustedSync.synchronize({
        ownerUserId: owner,
        currentDeviceId: trusted,
        pairingId: pairing,
        targetDeviceId: candidate,
        expiresAt,
      }),
      candidateSync.synchronize({
        ownerUserId: owner,
        currentDeviceId: candidate,
        pairingId: pairing,
        targetDeviceId: trusted,
        expiresAt,
      }),
    ])

    expect(trustedProgress.complete).toBe(true)
    expect(candidateProgress.complete).toBe(true)
    expect(candidateProgress.importedRecords).toBe(600)
    expect(candidateArchive.count()).toBe(1_000)
    for (const conversationId of directIds) {
      expect(candidateArchive.countConversation(conversationId)).toBe(150)
    }
    for (const conversationId of groupIds) {
      expect(candidateArchive.countConversation(conversationId)).toBe(200)
    }
    expect(relay.chunks).toHaveLength(40)
    expect(new Set(relay.chunks.map(chunk => (
      `${chunk.senderDeviceId}:${chunk.clientChunkId}`
    ))).size).toBe(relay.chunks.length)
    expect(relay.chunks.some(chunk => groupIds.includes(chunk.conversationId))).toBe(false)
    expect(relay.acknowledged.size).toBe(relay.chunks.length)
  })

  it('completes union when the second device starts only after the first polling pass', async () => {
    const trustedArchive = new MemoryArchive([archived(1, trusted, 'from phone')])
    const candidateArchive = new MemoryArchive([archived(2, candidate, 'from mac')])
    const relay: RelayState = { chunks: [], acknowledged: new Set() }
    const trustedJobs = new MemoryJobs()
    const candidateJobs = new MemoryJobs()
    const trustedService = service(trusted, trustedArchive, relay, trustedJobs)
    const candidateService = service(candidate, candidateArchive, relay, candidateJobs)
    const expiresAt = '2099-08-14T12:00:00Z'
    const trustedInput = {
      ownerUserId: owner,
      currentDeviceId: trusted,
      pairingId: pairing,
      targetDeviceId: candidate,
      expiresAt,
    }

    const firstTrusted = await trustedService.synchronize(trustedInput)
    expect(firstTrusted.complete).toBe(false)
    expect(firstTrusted.stage).toBe('waiting_peer')
    expect([...trustedArchive.records.keys()]).toEqual([1])
    const candidateInput = {
      ...trustedInput,
      currentDeviceId: candidate,
      targetDeviceId: trusted,
    }
    const firstCandidate = await candidateService.synchronize(candidateInput)
    expect(firstCandidate.complete).toBe(false)
    expect([...candidateArchive.records.keys()].sort()).toEqual([1, 2])
    const finalTrusted = await trustedService.synchronize(trustedInput)
    expect(finalTrusted.complete).toBe(true)
    expect([...trustedArchive.records.keys()].sort()).toEqual([1, 2])
    const resumedCandidate = candidateJobs.load(owner, candidate).at(0)
    expect(resumedCandidate?.peerCompletedConversationIds).toEqual([conversation])
    const finalCandidate = await candidateService.synchronize(resumedCandidate!)
    expect(finalCandidate.complete).toBe(true)
    expect(relay.acknowledged.size).toBe(4)
  })
})
