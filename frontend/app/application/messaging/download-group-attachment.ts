import type { MessageAttachment } from '../../domain/messaging/models'
import type { AttachmentGateway } from '../ports/attachment-gateway'
import type { MediaCache, MediaCacheScope } from '../ports/media-cache'
import type { AttachmentCipher } from '../ports/attachment-cipher'
import type { ImageThumbnailPort } from '../ports/image-thumbnail'
import type { DirectAttachmentSecrets } from './direct-message-content'

import { maximumAttachmentBytes } from './group-attachment-policy'

export class DownloadGroupAttachment {
  private readonly pending = new Map<string, Promise<Blob>>()
  private readonly previewPending = new Map<string, Promise<Blob>>()
  private readonly hot = new Map<string, Blob>()
  private readonly ownerGenerations = new Map<string, number>()
  private readonly previewQueue: Array<{
    run: () => Promise<Blob>
    resolve: (blob: Blob) => void
    reject: (reason?: unknown) => void
  }> = []
  private hotBytes = 0
  private activePreviewJobs = 0

  constructor(
    private readonly gateway: AttachmentGateway,
    private readonly cache?: MediaCache,
    private readonly maxHotBytes = 128 * 1024 * 1024,
    private readonly now: () => number = Date.now,
    private readonly cipher?: AttachmentCipher,
    private readonly directSecrets?: DirectAttachmentSecrets,
    private readonly thumbnail?: ImageThumbnailPort,
    private readonly maxPreviewJobs = 2,
  ) {
    if (!Number.isInteger(maxPreviewJobs) || maxPreviewJobs < 1 || maxPreviewJobs > 4) {
      throw new TypeError('invalid preview concurrency')
    }
  }

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
    const secret = this.directSecrets?.get(conversationId, attachment.attachmentId)
    const cachedAttachment: MessageAttachment = secret
      ? {
          attachmentId: attachment.attachmentId,
          kind: 'file',
          name: 'encrypted-attachment.bin',
          contentType: 'application/octet-stream',
          byteSize: secret.ciphertextByteSize,
        }
      : attachment
    const scope = this.scope(
      ownerUserId,
      ownerDeviceId,
      conversationId,
      cachedAttachment,
      expiresAt,
    )
    const cacheKey = this.cacheKey(scope)
    const hot = this.hot.get(cacheKey)
    if (hot && this.notExpired(expiresAt) && this.validBlob(hot, cachedAttachment)) {
      this.hot.delete(cacheKey)
      this.hot.set(cacheKey, hot)
      return await this.decryptIfNeeded(conversationId, attachment, hot)
    }
    if (hot) {
      this.hot.delete(cacheKey)
      this.hotBytes -= hot.size
    }
    const running = this.pending.get(cacheKey)
    if (running) return await this.decryptIfNeeded(conversationId, attachment, await running)
    const generation = this.ownerGeneration(scope.ownerUserId, scope.ownerDeviceId)
    const request = this.load(scope, generation).finally(() => this.pending.delete(cacheKey))
    this.pending.set(cacheKey, request)
    return await this.decryptIfNeeded(conversationId, attachment, await request)
  }

  async executePreview(
    ownerUserId: string,
    ownerDeviceId: string,
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ): Promise<Blob> {
    if (!ownerUserId || !ownerDeviceId || !conversationId || !attachment.attachmentId) {
      throw new TypeError('invalid attachment scope')
    }
    if (attachment.kind !== 'image') {
      return await this.execute(
        ownerUserId,
        ownerDeviceId,
        conversationId,
        attachment,
        expiresAt,
      )
    }
    if (!this.thumbnail) throw new TypeError('image thumbnail unavailable')
    const scope = this.scope(
      ownerUserId,
      ownerDeviceId,
      conversationId,
      attachment,
      expiresAt,
    )
    const cacheKey = this.cacheKey(scope, 'timeline-preview-v1')
    const hot = this.hot.get(cacheKey)
    if (hot && this.notExpired(expiresAt) && this.validPreview(hot)) {
      this.hot.delete(cacheKey)
      this.hot.set(cacheKey, hot)
      return hot
    }
    if (hot) {
      this.hot.delete(cacheKey)
      this.hotBytes -= hot.size
    }
    const running = this.previewPending.get(cacheKey)
    if (running) return await running
    const generation = this.ownerGeneration(ownerUserId, ownerDeviceId)
    const request = this.loadPreview(scope, attachment, generation)
      .finally(() => this.previewPending.delete(cacheKey))
    this.previewPending.set(cacheKey, request)
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

  private async loadPreview(
    scope: MediaCacheScope,
    attachment: MessageAttachment,
    generation: number,
  ): Promise<Blob> {
    const direct = Boolean(this.directSecrets?.get(
      scope.conversationId,
      attachment.attachmentId,
    ))
    const cached = direct
      ? null
      : await this.cache?.loadPreview(scope).catch(() => null)
    const cacheKey = this.cacheKey(scope, 'timeline-preview-v1')
    if (cached && this.validPreview(cached)) {
      if (this.generationIsCurrent(scope, generation)) this.remember(cacheKey, cached)
      return cached
    }
    const preview = await this.schedulePreview(async () => {
      if (!this.generationIsCurrent(scope, generation)) {
        throw new TypeError('image preview invalidated')
      }
      const source = await this.execute(
        scope.ownerUserId,
        scope.ownerDeviceId,
        scope.conversationId,
        attachment,
        scope.expiresAt,
      )
      return (await this.thumbnail!.create(source, 512)).body
    })
    if (!this.validPreview(preview)) throw new TypeError('invalid image preview')
    if (this.generationIsCurrent(scope, generation)) {
      this.remember(cacheKey, preview)
      if (!direct) await this.cache?.storePreview(scope, preview).catch(() => undefined)
    }
    return preview
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

  private cacheKey(scope: MediaCacheScope, variant?: string): string {
    return `${scope.ownerUserId}:${scope.ownerDeviceId}:${scope.conversationId}`
      + `:${scope.attachment.attachmentId}:${scope.attachment.kind}`
      + `:${scope.attachment.contentType}:${scope.attachment.byteSize}:${scope.expiresAt}`
      + (variant ? `:${variant}` : '')
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

  private validPreview(blob: Blob): boolean {
    return blob.size > 0 && blob.size <= 2 * 1024 * 1024 && blob.type === 'image/png'
  }

  private scope(
    ownerUserId: string,
    ownerDeviceId: string,
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ): MediaCacheScope {
    return { ownerUserId, ownerDeviceId, conversationId, attachment, expiresAt }
  }

  private schedulePreview(run: () => Promise<Blob>): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.previewQueue.push({ run, resolve, reject })
      this.drainPreviewQueue()
    })
  }

  private drainPreviewQueue(): void {
    while (this.activePreviewJobs < this.maxPreviewJobs) {
      const job = this.previewQueue.shift()
      if (!job) return
      this.activePreviewJobs += 1
      void job.run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.activePreviewJobs -= 1
          this.drainPreviewQueue()
        })
    }
  }

  private async decryptIfNeeded(
    conversationId: string,
    attachment: MessageAttachment,
    blob: Blob,
  ): Promise<Blob> {
    const secret = this.directSecrets?.get(conversationId, attachment.attachmentId)
    if (!secret) return blob
    if (!this.cipher) throw new TypeError('direct attachment cipher unavailable')
    const plaintext = await this.cipher.decrypt({
      conversationId,
      clientAttachmentId: secret.clientAttachmentId,
      kind: attachment.kind,
      contentType: attachment.contentType,
      plaintextBytes: attachment.byteSize,
    }, blob, secret.keyBase64, secret.nonceBase64)
    if (plaintext.size !== attachment.byteSize || plaintext.type !== attachment.contentType) {
      throw new TypeError('direct attachment plaintext mismatch')
    }
    return plaintext
  }
}
