export interface MessageCodec {
  readonly secure: boolean
  readonly label: string
  encode(plaintext: string): string
  decode(ciphertextBase64: string): string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/**
 * Temporary transport codec for MVP usability testing. It is encoding, not
 * encryption, and must be replaced by the reviewed E2EE adapter in BL-012–014.
 */
export const syntheticMessageCodec: MessageCodec = {
  secure: false,
  label: 'Тестовый режим: сообщения не защищены E2EE',
  encode(plaintext: string): string {
    return bytesToBase64(new TextEncoder().encode(plaintext))
  },
  decode(ciphertextBase64: string): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(ciphertextBase64))
    } catch {
      return 'Не удалось прочитать сообщение этого формата.'
    }
  },
}
