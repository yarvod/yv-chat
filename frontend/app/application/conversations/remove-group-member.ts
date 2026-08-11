import type { Conversation } from '../../domain/messaging/models'
import type { MessagingGateway } from '../ports/messaging-gateway'

export class RemoveGroupMember {
  constructor(private readonly gateway: MessagingGateway) {}

  execute(conversationId: string, userId: string): Promise<Conversation> {
    if (!conversationId || !userId) throw new TypeError('conversation and user are required')
    return this.gateway.removeGroupMember(conversationId, userId)
  }
}
