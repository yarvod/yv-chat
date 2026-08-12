import type { MessageAttachment } from '../../domain/messaging/models'
import type { AttachmentGateway } from '../ports/attachment-gateway'
import type { MediaCache, MediaCacheScope } from '../ports/media-cache'

import { maximumAttachmentBytes } from './group-attachment-policy'

export class DownloadGroupAttachment {
  private readonly pending = new Map<string, Promise<Blob>>()
  private readonly hot = new Map<string, Blob>()
  private readonly ownerGenerations = new Map<string, number>()
  private hotBytes = 0

  constructor(
    private readonly gateway: AttachmentGateway,
    private readonly cache?: MediaCache,
    private readonly maxHotBytes = 128 * 1024 * 1024,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(
    ownerUserId: string,
    ownerDeviceId: string,
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ): Promise<Blob> {
    if (!ownerUserId || !ownerDeviceId || !conversationId || !attachment.attachmentId) {
      throw new TypeError('invalid attachment scope')
    }
    const scope: MediaCacheScope = {
      ownerUserId,
      ownerDeviceId,
      conversationId,
      attachment,
      expiresAt,
    }
    const cacheKey = this.cacheKey(scope)
    const hot = this.hot.get(cacheKey)
    if (hot && this.notExpired(expiresAt) && this.validBlob(hot, attachment)) {
      this.hot.delete(cacheKey)
      this.hot.set(cacheKey, hot)
      return hot
    }
    if (hot) {
      this.hot.delete(cacheKey)
      this.hotBytes -= hot.size
    }
    const running = this.pending.get(cacheKey)
    if (running) return await running
    const generation = this.ownerGeneration(scope.ownerUserId, scope.ownerDeviceId)
    const request = this.load(scope, generation).finally(() => this.pending.delete(cacheKey))
    this.pending.set(cacheKey, request)
    return await request
  }

  clearMemory(ownerUserId: string, ownerDeviceId: string): void {
    const prefix = `${ownerUserId}:${ownerDeviceId}:`
    const ownerKey = this.ownerKey(ownerUserId, ownerDeviceId)
    this.ownerGenerations.set(ownerKey, this.ownerGeneration(ownerUserId, ownerDeviceId) + 1)
    for (const [key, blob] of this.hot) {
      if (!key.startsWith(prefix)) continue
      this.hot.delete(key)
      this.hotBytes -= blob.size
    }
  }

  private async load(scope: MediaCacheScope, generation: number): Promise<Blob> {
    const cached = await this.cache?.load(scope).catch(() => null)
    if (cached && this.validBlob(cached, scope.attachment)) {
      if (this.generationIsCurrent(scope, generation)) {
        this.remember(this.cacheKey(scope), cached)
      }
      return cached
    }
    const blob = await this.gateway.download(
      scope.conversationId,
      scope.attachment.attachmentId,
    )
    this.assertBlob(blob, scope.attachment)
    if (this.generationIsCurrent(scope, generation)) {
      this.remember(this.cacheKey(scope), blob)
      await this.cache?.store(scope, blob).catch(() => undefined)
    }
    return blob
  }

  private validBlob(blob: Blob, attachment: MessageAttachment): boolean {
    return blob.size > 0
      && blob.size <= maximumAttachmentBytes(attachment.kind)
      && blob.size === attachment.byteSize
      && (attachment.kind === 'file' || blob.type === attachment.contentType)
  }

  private assertBlob(blob: Blob, attachment: MessageAttachment): void {
    if (
      !this.validBlob(blob, attachment)
    ) {
      throw new TypeError('attachment response mismatch')
    }
  }

  private cacheKey(scope: MediaCacheScope): string {
    return `${scope.ownerUserId}:${scope.ownerDeviceId}:${scope.conversationId}`
      + `:${scope.attachment.attachmentId}:${scope.attachment.kind}`
      + `:${scope.attachment.contentType}:${scope.attachment.byteSize}:${scope.expiresAt}`
  }

  private notExpired(expiresAt: string): boolean {
    const expiry = Date.parse(expiresAt)
    return Number.isFinite(expiry) && expiry > this.now()
  }

  private ownerKey(ownerUserId: string, ownerDeviceId: string): string {
    return `${ownerUserId}:${ownerDeviceId}`
  }

  private ownerGeneration(ownerUserId: string, ownerDeviceId: string): number {
    return this.ownerGenerations.get(this.ownerKey(ownerUserId, ownerDeviceId)) ?? 0
  }

  private generationIsCurrent(scope: MediaCacheScope, generation: number): boolean {
    return this.ownerGeneration(scope.ownerUserId, scope.ownerDeviceId) === generation
  }

  private remember(key: string, blob: Blob): void {
    if (blob.size > this.maxHotBytes) return
    const previous = this.hot.get(key)
    if (previous) this.hotBytes -= previous.size
    this.hot.delete(key)
    this.hot.set(key, blob)
    this.hotBytes += blob.size
    while (this.hotBytes > this.maxHotBytes) {
      const oldest = this.hot.entries().next().value as [string, Blob] | undefined
      if (!oldest) break
      this.hot.delete(oldest[0])
      this.hotBytes -= oldest[1].size
    }
  }
}
