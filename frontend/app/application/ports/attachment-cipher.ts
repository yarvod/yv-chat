import type { MessageAttachmentKind } from '../../domain/messaging/models'

export interface AttachmentCipherScope {
  conversationId: string
  clientAttachmentId: string
  kind: MessageAttachmentKind
  contentType: string
  plaintextBytes: number
}

export interface EncryptedAttachmentBytes {
  ciphertext: Blob
  keyBase64: string
  nonceBase64: string
}

export interface AttachmentCipher {
  encrypt(scope: AttachmentCipherScope, plaintext: Blob): Promise<EncryptedAttachmentBytes>
  decrypt(
    scope: AttachmentCipherScope,
    ciphertext: Blob,
    keyBase64: string,
    nonceBase64: string,
  ): Promise<Blob>
}
