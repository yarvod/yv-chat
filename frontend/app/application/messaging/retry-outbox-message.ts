import type { Clock } from '../ports/clock'
import type { MessageOutbox } from '../ports/message-outbox'
import type { OutboxMessage } from '../../domain/messaging/outbox'

export class RetryOutboxMessage {
  constructor(
    private readonly outbox: MessageOutbox,
    private readonly clock: Clock,
  ) {}

  async execute(
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<OutboxMessage | null> {
    if (!ownerUserId || !senderDeviceId || !clientMessageId) {
      throw new TypeError('outbox scope is required')
    }
    const current = await this.outbox.get(ownerUserId, senderDeviceId, clientMessageId)
    if (!current || current.status !== 'failed') return current
    const pending: OutboxMessage = {
      ...current,
      status: 'pending',
      updatedAt: new Date(this.clock.nowMilliseconds()).toISOString(),
      nextAttemptAt: null,
      failureCode: null,
    }
    await this.outbox.replace(pending)
    return pending
  }
}
