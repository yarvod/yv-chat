import type { MessageOutbox } from '../ports/message-outbox'
import type { OutboxMessage } from '../../domain/messaging/outbox'

export class ListOutboxMessages {
  constructor(private readonly outbox: MessageOutbox) {}

  execute(ownerUserId: string, senderDeviceId: string): Promise<OutboxMessage[]> {
    if (!ownerUserId || !senderDeviceId) throw new TypeError('outbox scope is required')
    return this.outbox.list(ownerUserId, senderDeviceId)
  }
}
