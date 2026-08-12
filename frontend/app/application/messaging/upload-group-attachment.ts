import type { ClientIdGenerator } from '../ports/client-id-generator'
import type { AttachmentGateway } from '../ports/attachment-gateway'
import type {
  ConversationType,
  MessageAttachment,
  MessageAttachmentKind,
} from '../../domain/messaging/models'

const IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'])
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
const FILE_MAX_BYTES = 25 * 1024 * 1024

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
  ): Promise<MessageAttachment> {
    if (conversationType !== 'group') throw new TypeError('direct attachments require E2EE')
    const contentType = source.type || 'application/octet-stream'
    const kind: MessageAttachmentKind = IMAGE_TYPES.has(contentType) ? 'image' : 'file'
    const maximum = kind === 'image' ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
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
    const uploaded = await this.gateway.upload(conversationId, {
      clientAttachmentId,
      kind,
      contentType,
      byteSize: source.size,
      body: source.body,
    })
    return {
      attachmentId: uploaded.attachmentId,
      kind: uploaded.kind,
      name: safeDisplayName(source.name),
      contentType: uploaded.contentType,
      byteSize: uploaded.byteSize,
    }
  }
}
