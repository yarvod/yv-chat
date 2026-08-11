import type { Clock } from '../ports/clock'
import type { ClientIdGenerator } from '../ports/client-id-generator'
import type { MessageOutbox } from '../ports/message-outbox'
import type { OutboxMessage } from '../../domain/messaging/outbox'
import type { ProtocolMessageProtection } from './message-protection'

export interface QueueOutgoingMessageCommand {
  ownerUserId: string
  senderDeviceId: string
  conversationId: string
  plaintext: string
}

export class QueueOutgoingMessage {
  constructor(
    private readonly outbox: MessageOutbox,
    private readonly protection: ProtocolMessageProtection,
    private readonly clientIds: ClientIdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: QueueOutgoingMessageCommand): Promise<OutboxMessage> {
    const plaintext = command.plaintext.trim()
    if (
      !command.ownerUserId
      || !command.senderDeviceId
      || !command.conversationId
      || !plaintext
      || plaintext.length > 4_000
    ) {
      throw new TypeError('invalid outgoing message')
    }
    const clientMessageId = this.clientIds.create()
    const protectedMessage = await this.protection.protectText({
      conversationId: command.conversationId,
      clientMessageId,
      plaintext,
    })
    const now = new Date(this.clock.nowMilliseconds()).toISOString()
    const message: OutboxMessage = {
      ownerUserId: command.ownerUserId,
      senderDeviceId: command.senderDeviceId,
      clientMessageId,
      conversationId: command.conversationId,
      protocolVersion: protectedMessage.protocolVersion,
      ciphertextBase64: protectedMessage.ciphertextBase64,
      cryptoGenerationId: protectedMessage.cryptoGenerationId,
      cryptoEpoch: protectedMessage.cryptoEpoch,
      status: 'pending',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: null,
      failureCode: null,
    }
    await this.outbox.enqueue(message)
    return message
  }
}
