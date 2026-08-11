export interface MessageCodec {
  readonly secure: boolean
  readonly label: string
  encode(plaintext: string): string
  decode(ciphertextBase64: string): string
}
