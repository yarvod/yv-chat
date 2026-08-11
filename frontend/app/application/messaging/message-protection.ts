import type {
  MessageProtocolAdapter,
  ProtectTextInput,
  UnprotectTextInput,
} from '../ports/message-protocol-adapter'

export type MessageProtectionErrorKind =
  | 'corrupt-envelope'
  | 'provider-unavailable'
  | 'unsupported-protocol'

export class MessageProtectionError extends Error {
  constructor(readonly kind: MessageProtectionErrorKind) {
    super('message protection operation failed')
    this.name = 'MessageProtectionError'
  }
}

export interface ProtectedText {
  protocolVersion: number
  ciphertextBase64: string
}

export interface UnprotectedText {
  plaintext: string
  secure: boolean
}

export class ProtocolMessageProtection {
  private readonly adapters = new Map<number, MessageProtocolAdapter>()
  private readonly outgoingAdapter: MessageProtocolAdapter

  constructor(adapters: readonly MessageProtocolAdapter[], outgoingProtocolVersion: number) {
    for (const adapter of adapters) {
      if (!Number.isInteger(adapter.protocolVersion) || adapter.protocolVersion <= 0) {
        throw new TypeError('message protocol version must be a positive integer')
      }
      if (this.adapters.has(adapter.protocolVersion)) {
        throw new TypeError('duplicate message protocol adapter')
      }
      this.adapters.set(adapter.protocolVersion, adapter)
    }
    const outgoingAdapter = this.adapters.get(outgoingProtocolVersion)
    if (!outgoingAdapter) throw new TypeError('outgoing message protocol adapter is required')
    this.outgoingAdapter = outgoingAdapter
  }

  get secure(): boolean {
    return this.outgoingAdapter.secure
  }

  get label(): string {
    return this.outgoingAdapter.label
  }

  async protectText(input: ProtectTextInput): Promise<ProtectedText> {
    return {
      protocolVersion: this.outgoingAdapter.protocolVersion,
      ciphertextBase64: await this.outgoingAdapter.protectText(input),
    }
  }

  async unprotectText(
    protocolVersion: number,
    input: UnprotectTextInput,
  ): Promise<UnprotectedText> {
    const adapter = this.adapters.get(protocolVersion)
    if (!adapter) throw new MessageProtectionError('unsupported-protocol')
    return {
      plaintext: await adapter.unprotectText(input),
      secure: adapter.secure,
    }
  }
}
