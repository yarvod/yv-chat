import type { ClientIdGenerator } from '../ports/client-id-generator'
import type {
  AttachmentGateway,
  AttachmentUploadProgressHandler,
} from '../ports/attachment-gateway'
import type { AttachmentCipher } from '../ports/attachment-cipher'
import { VIDEO_NOTE_MAX_BYTES } from '../ports/video-note-recorder'
import type { MessageAttachmentKind } from '../../domain/messaging/models'

import type { DirectMessageAttachment, DirectAttachmentSecrets } from './direct-message-content'
import {
  attachmentKindFor,
  maximumDirectAttachmentBytes,
  normalizeAttachmentContentType,
} from './group-attachment-policy'
import type { GroupAttachmentSource } from './upload-group-attachment'
import { safeDisplayName } from './upload-group-attachment'

interface PreparedDirectAttachment {
  clientAttachmentId: string
  kind: MessageAttachmentKind
  contentType: string
  encrypted: Awaited<ReturnType<AttachmentCipher['encrypt']>>
}

export class UploadDirectAttachment {
  private readonly prepared = new WeakMap<Blob, {
    conversationId: string
    value: Promise<PreparedDirectAttachment>
  }>()

  constructor(
    private readonly gateway: AttachmentGateway,
    private readonly cipher: AttachmentCipher,
    private readonly secrets: DirectAttachmentSecrets,
    private readonly clientIds: ClientIdGenerator,
  ) {}

  async execute(
    conversationId: string,
    source: GroupAttachmentSource,
    onProgress?: AttachmentUploadProgressHandler,
  ): Promise<DirectMessageAttachment> {
    const contentType = normalizeAttachmentContentType(source.type)
    const kind = attachmentKindFor(contentType)
    const maximum = maximumDirectAttachmentBytes(kind)
    const videoNoteMetadataValid = source.presentation === undefined
      ? source.durationSeconds === undefined
      : source.presentation === 'video_note'
        && kind === 'video'
        && Number.isInteger(source.durationSeconds)
        && Number(source.durationSeconds) >= 1
        && Number(source.durationSeconds) <= 60
    if (
      !conversationId
      || source.size <= 0
      || source.size > maximum
      || source.body.size !== source.size
      || (source.presentation === 'video_note' && source.size > VIDEO_NOTE_MAX_BYTES)
      || !videoNoteMetadataValid
    ) throw new TypeError('invalid direct attachment source')

    let entry = this.prepared.get(source.body)
    if (!entry || entry.conversationId !== conversationId) {
      const clientAttachmentId = this.clientIds.create()
      entry = {
        conversationId,
        value: this.prepare(
          conversationId,
          clientAttachmentId,
          kind,
          contentType,
          source,
        ),
      }
      this.prepared.set(source.body, entry)
    }
    let prepared: PreparedDirectAttachment
    try {
      prepared = await entry.value
    } catch (error) {
      if (this.prepared.get(source.body) === entry) this.prepared.delete(source.body)
      throw error
    }
    const uploaded = await this.gateway.upload(
      conversationId,
      {
        clientAttachmentId: prepared.clientAttachmentId,
        kind: 'file',
        contentType: 'application/octet-stream',
        byteSize: prepared.encrypted.ciphertext.size,
        body: prepared.encrypted.ciphertext,
      },
      onProgress,
    )
    const attachment = {
      attachmentId: uploaded.attachmentId,
      kind,
      name: safeDisplayName(source.name),
      contentType,
      byteSize: source.size,
      ...(source.presentation ? { presentation: source.presentation } : {}),
      ...(source.durationSeconds ? { durationSeconds: source.durationSeconds } : {}),
    }
    const secret = {
      clientAttachmentId: prepared.clientAttachmentId,
      keyBase64: prepared.encrypted.keyBase64,
      nonceBase64: prepared.encrypted.nonceBase64,
      ciphertextByteSize: prepared.encrypted.ciphertext.size,
    }
    this.secrets.register(conversationId, attachment.attachmentId, secret)
    return { attachment, secret }
  }

  private async prepare(
    conversationId: string,
    clientAttachmentId: string,
    kind: MessageAttachmentKind,
    contentType: string,
    source: GroupAttachmentSource,
  ): Promise<PreparedDirectAttachment> {
    return {
      clientAttachmentId,
      kind,
      contentType,
      encrypted: await this.cipher.encrypt({
        conversationId,
        clientAttachmentId,
        kind,
        contentType,
        plaintextBytes: source.size,
      }, source.body),
    }
  }
}
