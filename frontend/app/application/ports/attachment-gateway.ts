import type { MessageAttachmentKind } from '../../domain/messaging/models'

export interface GroupAttachmentUpload {
  clientAttachmentId: string
  kind: MessageAttachmentKind
  contentType: string
  byteSize: number
  body: Blob
}

export interface UploadedGroupAttachment {
  attachmentId: string
  clientAttachmentId: string
  conversationId: string
  kind: MessageAttachmentKind
  contentType: string
  byteSize: number
  sha256Digest: string
  createdAt: string
  expiresAt: string
}

export interface AttachmentGateway {
  upload(conversationId: string, upload: GroupAttachmentUpload): Promise<UploadedGroupAttachment>
}
