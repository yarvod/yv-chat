import {
  MessageProtectionError,
} from '../../application/messaging/message-protection'
import type {
  MessageProtocolAdapter,
  ProtectedProtocolText,
  ProtectTextInput,
  UnprotectTextInput,
} from '../../application/ports/message-protocol-adapter'
import type {
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
} from '../../application/ports/mls-conversation-gateway'
import type { ReconcileConversationCryptoResult } from '../../application/conversation-crypto/reconcile-conversation-crypto'

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface MlsMessageSession {
  reconcileConversation(conversationId: string): Promise<ReconcileConversationCryptoResult>
  protectMessage(command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult>
  unprotectMessage(command: UnprotectMlsMessageCommand): Promise<UnprotectMlsMessageResult>
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    throw new MessageProtectionError('corrupt-envelope')
  }
  try {
    const binary = atob(value)
    if (btoa(binary) !== value) throw new Error('non-canonical')
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    throw new MessageProtectionError('corrupt-envelope')
  }
}

export class MlsMessageProtocol implements MessageProtocolAdapter {
  readonly protocolVersion = 2
  readonly secure = true
  readonly label = 'OpenMLS E2EE'

  constructor(private readonly session: MlsMessageSession) {}

  async protectText(input: ProtectTextInput): Promise<ProtectedProtocolText> {
    const generation = await this.requireReady(input.conversationId)
    try {
      const result = await this.session.protectMessage({
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
        plaintext: new TextEncoder().encode(input.plaintext),
      })
      if (result.epoch !== generation.epoch || generation.epoch === null) {
        throw new MessageProtectionError('provider-unavailable')
      }
      return {
        ciphertextBase64: encodeBase64(result.ciphertext),
        cryptoGenerationId: generation.generationId,
        cryptoEpoch: result.epoch,
      }
    } catch {
      throw new MessageProtectionError('provider-unavailable')
    }
  }

  async unprotectText(input: UnprotectTextInput): Promise<string> {
    try {
      const result = await this.session.unprotectMessage({
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
        ciphertext: decodeBase64(input.ciphertextBase64),
      })
      return new TextDecoder('utf-8', { fatal: true }).decode(result.plaintext)
    } catch (error) {
      if (error instanceof MessageProtectionError) throw error
      throw new MessageProtectionError('corrupt-envelope')
    }
  }

  private async requireReady(
    conversationId: string,
  ): Promise<ReconcileConversationCryptoResult> {
    try {
      const state = await this.session.reconcileConversation(conversationId)
      if (state.status !== 'ready' || state.epoch === null) {
        throw new Error('generation is not ready')
      }
      return state
    } catch {
      throw new MessageProtectionError('provider-unavailable')
    }
  }
}
