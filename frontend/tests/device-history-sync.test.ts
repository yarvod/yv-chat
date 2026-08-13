import { describe, expect, it } from 'vitest'

import { SynchronizeDeviceHistory } from '../app/application/device-crypto/synchronize-device-history'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import type { DeviceHistorySyncJob, DeviceHistorySyncJobStore } from '../app/application/ports/device-history-sync-jobs'
import type { DevicePairingGateway } from '../app/application/ports/device-pairing-gateway'
import type { MessageArchive, ArchivedMessage } from '../app/application/ports/message-archive'
import type { MessageProtocolAdapter } from '../app/application/ports/message-protocol-adapter'
import type { Scheduler, ScheduledTask } from '../app/application/ports/scheduler'
import type { DeviceHistoryRelayChunk } from '../app/domain/accounts/device-pairing'

const owner = '11111111-1111-4111-8111-111111111111'
const trusted = '22222222-2222-4222-8222-222222222222'
const candidate = '33333333-3333-4333-8333-333333333333'
const pairing = '44444444-4444-4444-8444-444444444444'
const conversation = '55555555-5555-4555-8555-555555555555'

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

function service(
  currentDeviceId: string,
  archive: MessageArchive,
  relay: RelayState,
  jobs: DeviceHistorySyncJobStore,
) {
  return new SynchronizeDeviceHistory(
    new RelayGateway(relay, currentDeviceId) as unknown as DevicePairingGateway,
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
    archive,
    new ProtocolMessageProtection([adapter]),
    jobs,
    scheduler,
    4,
  )
}

describe('QR-linked bidirectional device history sync', () => {
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
    expect(relay.acknowledged.size).toBe(2)
  })
})
