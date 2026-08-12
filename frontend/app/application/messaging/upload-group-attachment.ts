import type { ClientIdGenerator } from '../ports/client-id-generator'
import type {
  AttachmentGateway,
  AttachmentUploadProgressHandler,
} from '../ports/attachment-gateway'
import type {
  ConversationType,
  MessageAttachment,
  MessageAttachmentKind,
} from '../../domain/messaging/models'
import {
  attachmentKindFor,
  maximumAttachmentBytes,
  normalizeAttachmentContentType,
} from './group-attachment-policy'

export interface GroupAttachmentSource {
  name: string
  type: string
  size: number
  body: Blob
}

function safeDisplayName(value: string): string {
  const name = [...(value.split(/[\\/]/).at(-1) ?? '')]
    .filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
  return name.slice(0, 180) || 'Файл'
}

export class UploadGroupAttachment {
  private readonly clientAttachmentIds = new WeakMap<Blob, string>()

  constructor(
    private readonly gateway: AttachmentGateway,
    private readonly clientIds: ClientIdGenerator,
  ) {}

  async execute(
    conversationId: string,
    conversationType: ConversationType,
    source: GroupAttachmentSource,
    onProgress?: AttachmentUploadProgressHandler,
  ): Promise<MessageAttachment> {
    if (conversationType !== 'group') throw new TypeError('direct attachments require E2EE')
    const contentType = normalizeAttachmentContentType(source.type)
    const kind: MessageAttachmentKind = attachmentKindFor(contentType)
    const maximum = maximumAttachmentBytes(kind)
    if (
      !conversationId
      || source.size <= 0
      || source.size > maximum
      || source.body.size !== source.size
    ) throw new TypeError('invalid attachment source')
    let clientAttachmentId = this.clientAttachmentIds.get(source.body)
    if (!clientAttachmentId) {
      clientAttachmentId = this.clientIds.create()
      this.clientAttachmentIds.set(source.body, clientAttachmentId)
    }
    const uploaded = await this.gateway.upload(
      conversationId,
      {
        clientAttachmentId,
        kind,
        contentType,
        byteSize: source.size,
        body: source.body,
      },
      onProgress,
    )
    return {
      attachmentId: uploaded.attachmentId,
      kind: uploaded.kind,
      name: safeDisplayName(source.name),
      contentType: uploaded.contentType,
      byteSize: uploaded.byteSize,
    }
  }
}
