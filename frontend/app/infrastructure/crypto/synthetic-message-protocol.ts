import { MessageProtectionError } from '../../application/messaging/message-protection'
import type {
  MessageProtocolAdapter,
  ProtectedProtocolText,
  ProtectTextInput,
  UnprotectTextInput,
} from '../../application/ports/message-protocol-adapter'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
  if (value.length === 0 || value.length % 4 !== 0 || !canonicalBase64.test(value)) {
    throw new MessageProtectionError('corrupt-envelope')
  }
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    throw new MessageProtectionError('corrupt-envelope')
  }
}

/** Temporary protocol v1 transport adapter. Encoding only; never E2EE. */
export class SyntheticMessageProtocol implements MessageProtocolAdapter {
  readonly protocolVersion = 1
  readonly secure = false
  readonly label = 'Тестовый режим: сообщения не защищены E2EE'

  async protectText(input: ProtectTextInput): Promise<ProtectedProtocolText> {
    return {
      ciphertextBase64: bytesToBase64(new TextEncoder().encode(input.plaintext)),
      cryptoGenerationId: null,
      cryptoEpoch: null,
    }
  }

  async unprotectText(input: UnprotectTextInput): Promise<string> {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        base64ToBytes(input.ciphertextBase64),
      )
    } catch {
      throw new MessageProtectionError('corrupt-envelope')
    }
  }
}
