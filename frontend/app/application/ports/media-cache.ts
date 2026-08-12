import type { MessageAttachment } from '../../domain/messaging/models'

export const DEFAULT_DEVICE_MEDIA_CACHE_BYTES = 2 * 1024 * 1024 * 1024

export interface MediaCacheScope {
  ownerUserId: string
  ownerDeviceId: string
  conversationId: string
  attachment: MessageAttachment
  expiresAt: string
}

export interface MediaCacheStatistics {
  usedBytes: number
  entryCount: number
  limitBytes: number
}

export interface MediaCache {
  load(scope: MediaCacheScope): Promise<Blob | null>
  store(scope: MediaCacheScope, blob: Blob): Promise<void>
  remove(scope: MediaCacheScope): Promise<void>
  inspect(ownerUserId: string, ownerDeviceId: string): Promise<MediaCacheStatistics>
  clear(ownerUserId: string, ownerDeviceId: string): Promise<MediaCacheStatistics>
  close(): void
}

export interface MediaHotCache {
  clearMemory(ownerUserId: string, ownerDeviceId: string): void
}
