import type {
  MediaCache,
  MediaCacheStatistics,
  MediaHotCache,
} from '../ports/media-cache'

export class ClearDeviceMediaCache {
  constructor(
    private readonly cache: MediaCache,
    private readonly hotCache: MediaHotCache,
  ) {}

  async execute(ownerUserId: string, ownerDeviceId: string): Promise<MediaCacheStatistics> {
    this.hotCache.clearMemory(ownerUserId, ownerDeviceId)
    return await this.cache.clear(ownerUserId, ownerDeviceId)
  }
}
