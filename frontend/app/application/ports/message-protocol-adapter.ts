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

export interface MessageProtocolAdapter {
  readonly protocolVersion: number
  readonly secure: boolean
  readonly label: string
  protectText(input: ProtectTextInput): Promise<string>
  unprotectText(input: UnprotectTextInput): Promise<string>
}
