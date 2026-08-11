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
  cryptoGenerationId: string | null
  cryptoEpoch: number | null
}

export interface UnprotectedText {
  plaintext: string
  secure: boolean
}

export class ProtocolMessageProtection {
  private readonly adapters = new Map<number, MessageProtocolAdapter>()

  constructor(adapters: readonly MessageProtocolAdapter[]) {
    for (const adapter of adapters) {
      if (!Number.isInteger(adapter.protocolVersion) || adapter.protocolVersion <= 0) {
        throw new TypeError('message protocol version must be a positive integer')
      }
      if (this.adapters.has(adapter.protocolVersion)) {
        throw new TypeError('duplicate message protocol adapter')
      }
      this.adapters.set(adapter.protocolVersion, adapter)
    }
  }

  isSecure(protocolVersion: number): boolean {
    return this.requireAdapter(protocolVersion).secure
  }

  labelFor(protocolVersion: number): string {
    return this.requireAdapter(protocolVersion).label
  }

  async protectText(
    protocolVersion: number,
    input: ProtectTextInput,
  ): Promise<ProtectedText> {
    const adapter = this.requireAdapter(protocolVersion)
    const protectedText = await adapter.protectText(input)
    return {
      protocolVersion: adapter.protocolVersion,
      ...protectedText,
    }
  }

  async unprotectText(
    protocolVersion: number,
    input: UnprotectTextInput,
  ): Promise<UnprotectedText> {
    const adapter = this.requireAdapter(protocolVersion)
    return {
      plaintext: await adapter.unprotectText(input),
      secure: adapter.secure,
    }
  }

  private requireAdapter(protocolVersion: number): MessageProtocolAdapter {
    const adapter = this.adapters.get(protocolVersion)
    if (!adapter) throw new MessageProtectionError('unsupported-protocol')
    return adapter
  }
}
