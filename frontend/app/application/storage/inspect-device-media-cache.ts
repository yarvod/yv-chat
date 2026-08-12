import type { MediaCache, MediaCacheStatistics } from '../ports/media-cache'

export class InspectDeviceMediaCache {
  constructor(private readonly cache: MediaCache) {}

  execute(ownerUserId: string, ownerDeviceId: string): Promise<MediaCacheStatistics> {
    return this.cache.inspect(ownerUserId, ownerDeviceId)
  }
}
