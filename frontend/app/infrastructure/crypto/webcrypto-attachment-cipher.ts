import type {
  AttachmentCipher,
  AttachmentCipherScope,
  EncryptedAttachmentBytes,
} from '../../application/ports/attachment-cipher'

const KEY_BYTES = 32
const NONCE_BYTES = 12

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBuffer(value: string, expectedLength: number): ArrayBuffer {
  try {
    const binary = atob(value)
    if (binary.length !== expectedLength || btoa(binary) !== value) throw new Error()
    return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer
  } catch {
    throw new TypeError('invalid attachment cipher material')
  }
}

function additionalData(scope: AttachmentCipherScope): ArrayBuffer {
  if (
    !scope.conversationId
    || !scope.clientAttachmentId
    || !scope.contentType
    || !Number.isSafeInteger(scope.plaintextBytes)
    || scope.plaintextBytes <= 0
  ) throw new TypeError('invalid attachment cipher scope')
  return new TextEncoder().encode(`yv-chat/direct-attachment/v1:${JSON.stringify({
    conversation_id: scope.conversationId,
    client_attachment_id: scope.clientAttachmentId,
    kind: scope.kind,
    content_type: scope.contentType,
    plaintext_bytes: scope.plaintextBytes,
  })}`).buffer
}

export class WebCryptoAttachmentCipher implements AttachmentCipher {
  constructor(
    private readonly subtle: SubtleCrypto = crypto.subtle,
    private readonly randomValues: <T extends ArrayBufferView>(array: T) => T = array => (
      crypto.getRandomValues(array)
    ),
  ) {}

  async encrypt(
    scope: AttachmentCipherScope,
    plaintext: Blob,
  ): Promise<EncryptedAttachmentBytes> {
    if (plaintext.size !== scope.plaintextBytes) throw new TypeError('attachment size mismatch')
    const keyBytes = this.randomValues(new Uint8Array(KEY_BYTES))
    const nonce = this.randomValues(new Uint8Array(NONCE_BYTES))
    const key = await this.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
    const ciphertext = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: additionalData(scope), tagLength: 128 },
      key,
      await plaintext.arrayBuffer(),
    )
    return {
      ciphertext: new Blob([ciphertext], { type: 'application/octet-stream' }),
      keyBase64: bytesToBase64(keyBytes),
      nonceBase64: bytesToBase64(nonce),
    }
  }

  async decrypt(
    scope: AttachmentCipherScope,
    ciphertext: Blob,
    keyBase64: string,
    nonceBase64: string,
  ): Promise<Blob> {
    if (ciphertext.size !== scope.plaintextBytes + 16) {
      throw new TypeError('attachment ciphertext size mismatch')
    }
    const key = await this.subtle.importKey(
      'raw',
      base64ToBuffer(keyBase64, KEY_BYTES),
      'AES-GCM',
      false,
      ['decrypt'],
    )
    try {
      const plaintext = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToBuffer(nonceBase64, NONCE_BYTES),
          additionalData: additionalData(scope),
          tagLength: 128,
        },
        key,
        await ciphertext.arrayBuffer(),
      )
      return new Blob([plaintext], { type: scope.contentType })
    } catch {
      throw new TypeError('attachment authentication failed')
    }
  }
}
