export interface DeviceHistorySyncJob {
  ownerUserId: string
  currentDeviceId: string
  pairingId: string
  targetDeviceId: string
  expiresAt: string
  prepareTarget?: boolean
  peerCompletedConversationIds?: readonly string[]
  cancelRequested?: boolean
}

export interface DeviceHistorySyncJobStore {
  save(job: DeviceHistorySyncJob): void
  load(ownerUserId: string, currentDeviceId: string): readonly DeviceHistorySyncJob[]
  remove(pairingId: string): void
}
