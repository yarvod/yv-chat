import type { Conversation } from '../../domain/messaging/models'
import type { MessagingGateway } from '../ports/messaging-gateway'

export class RenameGroup {
  constructor(private readonly gateway: MessagingGateway) {}

  execute(conversationId: string, title: string): Promise<Conversation> {
    const normalized = title.trim()
    if (!conversationId || normalized.length === 0 || normalized.length > 100) {
      throw new TypeError('valid conversation and title are required')
    }
    return this.gateway.renameGroup(conversationId, normalized)
  }
}
