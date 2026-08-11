import type { MessageCodec } from '../../application/ports/message-codec'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Temporary transport adapter. Encoding only; it is not encryption or E2EE. */
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
