import type { MessageAttachment } from '../../domain/messaging/models'

export const DEFAULT_DEVICE_MEDIA_CACHE_BYTES = 2 * 1024 * 1024 * 1024

export interface MediaCacheScope {
  ownerUserId: string
  ownerDeviceId: string
  conversationId: string
  attachment: MessageAttachment
  expiresAt: string
}

export interface MediaCache {
  load(scope: MediaCacheScope): Promise<Blob | null>
  store(scope: MediaCacheScope, blob: Blob): Promise<void>
  remove(scope: MediaCacheScope): Promise<void>
  close(): void
}
