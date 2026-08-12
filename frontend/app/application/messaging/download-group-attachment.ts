import type { MessageAttachment } from '../../domain/messaging/models'
import type { AttachmentGateway } from '../ports/attachment-gateway'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export class DownloadGroupAttachment {
  constructor(private readonly gateway: AttachmentGateway) {}

  async execute(conversationId: string, attachment: MessageAttachment): Promise<Blob> {
    if (!conversationId || !attachment.attachmentId) {
      throw new TypeError('invalid attachment scope')
    }
    const blob = await this.gateway.download(conversationId, attachment.attachmentId)
    if (
      blob.size <= 0
      || blob.size > MAX_ATTACHMENT_BYTES
      || blob.size !== attachment.byteSize
      || (attachment.kind === 'image' && blob.type !== attachment.contentType)
    ) {
      throw new TypeError('attachment response mismatch')
    }
    return blob
  }
}
