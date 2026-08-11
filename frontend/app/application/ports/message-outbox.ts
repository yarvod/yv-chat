import type { OutboxMessage } from '../../domain/messaging/outbox'

export type MessageOutboxErrorKind = 'corrupt' | 'queue-full' | 'storage-unavailable'

export class MessageOutboxError extends Error {
  constructor(readonly kind: MessageOutboxErrorKind) {
    super(`message outbox: ${kind}`)
    this.name = 'MessageOutboxError'
  }
}

export interface MessageOutbox {
  enqueue(message: OutboxMessage): Promise<void>
  get(
    ownerUserId: string,
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<OutboxMessage | null>
  list(ownerUserId: string, senderDeviceId: string): Promise<OutboxMessage[]>
  replace(message: OutboxMessage): Promise<void>
  remove(ownerUserId: string, senderDeviceId: string, clientMessageId: string): Promise<void>
  close(): void
}
