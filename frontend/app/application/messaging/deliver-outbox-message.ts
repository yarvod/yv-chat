import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { MessageOutbox } from '../ports/message-outbox'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { SendMessageReceipt } from '../../domain/messaging/models'
import type {
  OutboxFailureCode,
  OutboxMessage,
} from '../../domain/messaging/outbox'

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 300_000] as const

export type OutboxDeliveryResult =
  | { kind: 'deferred', message: OutboxMessage }
  | { kind: 'retryable', message: OutboxMessage }
  | { kind: 'failed', message: OutboxMessage }
  | { kind: 'sent', message: OutboxMessage, receipt: SendMessageReceipt }

function retryable(error: unknown): boolean {
  return error instanceof ApplicationError && (
    error.kind === 'network'
    || error.kind === 'invalid-response'
    || error.status === 408
    || error.status === 429
    || (error.status !== null && error.status >= 500)
  )
}

function failureCode(error: unknown): OutboxFailureCode {
  if (error instanceof ApplicationError && error.status === 409) return 'conflict'
  if (error instanceof ApplicationError && error.status === 401) return 'unauthorized'
  if (error instanceof ApplicationError && error.status === 403) return 'forbidden'
  return 'rejected'
}

export class DeliverOutboxMessage {
  constructor(
    private readonly outbox: MessageOutbox,
    private readonly gateway: MessagingGateway,
    private readonly clock: Clock,
  ) {}

  async execute(message: OutboxMessage): Promise<OutboxDeliveryResult> {
    const nowMilliseconds = this.clock.nowMilliseconds()
    if (
      message.status === 'pending'
      && message.nextAttemptAt !== null
      && Date.parse(message.nextAttemptAt) > nowMilliseconds
    ) {
      return { kind: 'deferred', message }
    }
    if (message.status === 'failed') return { kind: 'failed', message }

    const sending: OutboxMessage = {
      ...message,
      status: 'sending',
      attemptCount: message.attemptCount + 1,
      updatedAt: new Date(nowMilliseconds).toISOString(),
      nextAttemptAt: null,
      failureCode: null,
    }
    await this.outbox.replace(sending)
    try {
      const receipt = await this.gateway.sendMessage(
        sending.conversationId,
        sending.clientMessageId,
        sending.protocolVersion,
        sending.ciphertextBase64,
      )
      if (
        receipt.clientMessageId !== sending.clientMessageId
        || receipt.conversationId !== sending.conversationId
        || receipt.senderUserId !== sending.ownerUserId
        || receipt.senderDeviceId !== sending.senderDeviceId
        || receipt.protocolVersion !== sending.protocolVersion
        || !Number.isSafeInteger(receipt.sequence)
        || receipt.sequence <= 0
      ) {
        throw new ApplicationError(200, 'invalid-response', 'send receipt scope mismatch')
      }
      const sent: OutboxMessage = {
        ...sending,
        status: 'sent',
        updatedAt: new Date(this.clock.nowMilliseconds()).toISOString(),
      }
      await this.outbox.replace(sent)
      return { kind: 'sent', message: sent, receipt }
    } catch (error) {
      if (retryable(error)) {
        const delayIndex = Math.min(sending.attemptCount - 1, RETRY_DELAYS_MS.length - 1)
        const delay = RETRY_DELAYS_MS[delayIndex] ?? 300_000
        const pending: OutboxMessage = {
          ...sending,
          status: 'pending',
          updatedAt: new Date(this.clock.nowMilliseconds()).toISOString(),
          nextAttemptAt: new Date(this.clock.nowMilliseconds() + delay).toISOString(),
        }
        await this.outbox.replace(pending)
        return { kind: 'retryable', message: pending }
      }
      const failed: OutboxMessage = {
        ...sending,
        status: 'failed',
        updatedAt: new Date(this.clock.nowMilliseconds()).toISOString(),
        nextAttemptAt: null,
        failureCode: failureCode(error),
      }
      await this.outbox.replace(failed)
      return { kind: 'failed', message: failed }
    }
  }
}
