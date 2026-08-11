import type { MessageOutbox } from '../ports/message-outbox'

export class AcknowledgeOutboxMessage {
  constructor(private readonly outbox: MessageOutbox) {}

  execute(ownerUserId: string, senderDeviceId: string, clientMessageId: string): Promise<void> {
    if (!ownerUserId || !senderDeviceId || !clientMessageId) {
      throw new TypeError('outbox scope is required')
    }
    return this.outbox.remove(ownerUserId, senderDeviceId, clientMessageId)
  }
}
