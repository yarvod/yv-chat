import type { ConversationReadState } from '../../domain/messaging/models'
import type { DeliveredNotifications } from '../ports/delivered-notifications'
import type { MessagingGateway } from '../ports/messaging-gateway'

interface MessageSequence {
  conversationId: string
  messageId: string
  sequence: number
}

export class DismissReadNotifications {
  private running: Promise<void> | null = null
  private pending: { cursors: Map<string, number>, messages: readonly MessageSequence[] } | null = null

  constructor(
    private readonly notifications: DeliveredNotifications,
    private readonly gateway: Pick<MessagingGateway, 'getMessage'>,
  ) {}

  execute(
    readStates: readonly Pick<ConversationReadState, 'conversationId' | 'lastReadSequence'>[],
    knownMessages: readonly MessageSequence[] = [],
  ): Promise<void> {
    const cursors = this.pending?.cursors ?? new Map<string, number>()
    for (const state of readStates) {
      if (Number.isSafeInteger(state.lastReadSequence) && state.lastReadSequence > 0) {
        cursors.set(state.conversationId, Math.max(
          cursors.get(state.conversationId) ?? 0, state.lastReadSequence,
        ))
      }
    }
    if (cursors.size === 0) return this.running ?? Promise.resolve()
    this.pending = { cursors, messages: knownMessages }
    // Coalesce rapid viewport/sync updates; never build a queue of HTTP lookups.
    this.running ??= Promise.resolve().then(async () => {
      while (this.pending) {
        const batch = this.pending
        this.pending = null
        await this.dismiss(batch.cursors, batch.messages)
      }
    }).finally(() => {
      this.running = null
      if (this.pending) return this.execute([], this.pending.messages)
    })
    return this.running
  }

  private async dismiss(cursors: ReadonlyMap<string, number>, knownMessages: readonly MessageSequence[]): Promise<void> {
    try {
      const delivered = await this.notifications.listMessages()
      const dismissed = []
      for (const notification of delivered) {
        const cursor = cursors.get(notification.conversationId)
        if (cursor === undefined) continue
        try {
          // IDs are not ordered. Resolve only actual delivered messages outside
          // the current window, sequentially to bound concurrent requests.
          const message = knownMessages.find(message => (
            message.conversationId === notification.conversationId
            && message.messageId === notification.messageId
          )) ?? await this.gateway.getMessage(notification.conversationId, notification.messageId)
          if (message.conversationId === notification.conversationId
            && message.messageId === notification.messageId
            && Number.isSafeInteger(message.sequence) && message.sequence > 0
            && message.sequence <= cursor) dismissed.push(notification)
        } catch {
          // Offline, expired or unauthorized metadata cannot prove a read.
          // Keep this notification; a later authoritative reconciliation retries.
        }
      }
      if (dismissed.length > 0) await this.notifications.dismissMessages(dismissed)
    } catch {
      // System notification APIs are best effort and must never fail a receipt.
    }
  }
}
