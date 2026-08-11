export interface ProtectTextInput {
  conversationId: string
  clientMessageId: string
  plaintext: string
}

export interface UnprotectTextInput {
  conversationId: string
  clientMessageId: string
  ciphertextBase64: string
}

export interface ProtectedProtocolText {
  readonly ciphertextBase64: string
  readonly cryptoGenerationId: string | null
  readonly cryptoEpoch: number | null
}

export interface MessageProtocolAdapter {
  readonly protocolVersion: number
  readonly secure: boolean
  readonly label: string
  protectText(input: ProtectTextInput): Promise<ProtectedProtocolText>
  unprotectText(input: UnprotectTextInput): Promise<string>
}
