import type { MessagingGateway } from '../ports/messaging-gateway'
import type { DeleteMessageResult } from '../../domain/messaging/models'

export class DeleteMessageForEveryone {
  constructor(private readonly gateway: MessagingGateway) {}

  execute(conversationId: string, messageId: string): Promise<DeleteMessageResult> {
    if (!conversationId || !messageId) {
      throw new TypeError('conversation and message are required')
    }
    return this.gateway.deleteMessage(conversationId, messageId)
  }
}
