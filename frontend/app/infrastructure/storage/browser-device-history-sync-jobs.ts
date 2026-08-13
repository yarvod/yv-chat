import type {
  DeviceHistorySyncJob,
  DeviceHistorySyncJobStore,
} from '../../application/ports/device-history-sync-jobs'

const STORAGE_KEY = 'yv-chat-device-history-sync-jobs-v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validJob(value: unknown): value is DeviceHistorySyncJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return ['ownerUserId', 'currentDeviceId', 'pairingId', 'targetDeviceId']
    .every(field => typeof item[field] === 'string' && UUID.test(item[field]))
    && typeof item.expiresAt === 'string'
    && Number.isFinite(Date.parse(item.expiresAt))
    && (item.prepareTarget === undefined || typeof item.prepareTarget === 'boolean')
    && (item.peerCompletedConversationIds === undefined || (
      Array.isArray(item.peerCompletedConversationIds)
      && item.peerCompletedConversationIds.every(
        value => typeof value === 'string' && UUID.test(value),
      )
    ))
}

export class BrowserDeviceHistorySyncJobStore implements DeviceHistorySyncJobStore {
  constructor(private readonly storage: Storage = localStorage) {}

  save(job: DeviceHistorySyncJob): void {
    if (!validJob(job)) throw new TypeError('invalid device history sync job')
    const jobs = this.read().filter(item => item.pairingId !== job.pairingId)
    this.storage.setItem(STORAGE_KEY, JSON.stringify([...jobs, job]))
  }

  load(ownerUserId: string, currentDeviceId: string): readonly DeviceHistorySyncJob[] {
    const now = Date.now()
    const current = this.read().filter(job => Date.parse(job.expiresAt) > now)
    this.storage.setItem(STORAGE_KEY, JSON.stringify(current))
    return current.filter(job => (
      job.ownerUserId === ownerUserId && job.currentDeviceId === currentDeviceId
    ))
  }

  remove(pairingId: string): void {
    this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify(this.read().filter(item => item.pairingId !== pairingId)),
    )
  }

  private read(): DeviceHistorySyncJob[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '[]')
      return Array.isArray(value) ? value.filter(validJob) : []
    } catch {
      return []
    }
  }
}
