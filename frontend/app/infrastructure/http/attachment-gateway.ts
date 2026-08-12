import { ApplicationError } from '../../application/errors'
import type {
  AttachmentGateway,
  GroupAttachmentUpload,
  UploadedGroupAttachment,
} from '../../application/ports/attachment-gateway'
import type { ApiClient } from './api-client'
import { integerField, record, stringField } from './runtime-parsers'

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseUpload(value: unknown): UploadedGroupAttachment {
  const item = record(value)
  const kind = stringField(item, 'media_kind')
  if (kind !== 'image' && kind !== 'file') {
    throw new ApplicationError(200, 'invalid-response', 'invalid attachment kind')
  }
  return {
    attachmentId: stringField(item, 'attachment_id'),
    clientAttachmentId: stringField(item, 'client_attachment_id'),
    conversationId: stringField(item, 'conversation_id'),
    kind,
    contentType: stringField(item, 'content_type'),
    byteSize: integerField(item, 'byte_size'),
    sha256Digest: stringField(item, 'sha256_digest'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

export class HttpAttachmentGateway implements AttachmentGateway {
  constructor(
    private readonly apiClient: ApiClient,
    private readonly subtle: SubtleCrypto,
  ) {}

  async upload(
    conversationId: string,
    upload: GroupAttachmentUpload,
  ): Promise<UploadedGroupAttachment> {
    const digest = hex(await this.subtle.digest('SHA-256', await upload.body.arrayBuffer()))
    const query = new URLSearchParams({
      media_kind: upload.kind,
      byte_size: String(upload.byteSize),
      sha256: digest,
      content_type: upload.contentType,
    })
    const result = parseUpload(await this.apiClient.upload(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/attachments/${encodeURIComponent(upload.clientAttachmentId)}?${query}`,
      upload.body,
    ))
    if (
      result.clientAttachmentId !== upload.clientAttachmentId
      || result.conversationId !== conversationId
      || result.kind !== upload.kind
      || result.contentType !== upload.contentType
      || result.byteSize !== upload.byteSize
      || result.sha256Digest !== digest
    ) throw new ApplicationError(200, 'invalid-response', 'attachment receipt scope mismatch')
    return result
  }

  async download(conversationId: string, attachmentId: string): Promise<Blob> {
    return await this.apiClient.download(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/attachments/${encodeURIComponent(attachmentId)}`,
    )
  }
}
