import type { ArchivedMessage, MessageArchive } from '../ports/message-archive'
import type { ProtocolMessageProtection } from './message-protection'

/** Rebuilds a device's archive from envelopes its current MLS state can open. */
export class RecoverLegacyMessageArchive {
  constructor(
    private readonly archive: MessageArchive,
    private readonly protection: ProtocolMessageProtection,
  ) {}

  async execute(
    storageScope: string,
    conversationId: string,
    scoped: readonly ArchivedMessage[],
    legacy: readonly ArchivedMessage[],
  ): Promise<ArchivedMessage[]> {
    const bySequence = new Map(scoped.map(message => [message.sequence, message]))
    const recovered: ArchivedMessage[] = []
    for (const message of legacy) {
      if (message.protocolVersion !== 2 || message.ciphertextBase64 === null) continue
      const existing = bySequence.get(message.sequence)
      if (existing && (
        existing.localPlaintext !== undefined
        || existing.messageId !== message.messageId
        || existing.ciphertextBase64 !== message.ciphertextBase64
      )) continue
      try {
        const { plaintext, secure } = await this.protection.unprotectText(2, {
          conversationId,
          clientMessageId: message.clientMessageId,
          ciphertextBase64: message.ciphertextBase64,
        })
        if (secure) recovered.push({ ...message, ...existing, localPlaintext: plaintext })
      } catch {
        // A legacy cached body does not establish access for this device.
      }
    }
    if (recovered.length > 0) {
      await this.archive.put(storageScope, conversationId, recovered)
      for (const message of recovered) bySequence.set(message.sequence, message)
    }
    return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
  }
}
