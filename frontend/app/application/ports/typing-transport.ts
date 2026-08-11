export interface TypingTransport {
  setTyping(conversationId: string, active: boolean): void
}
