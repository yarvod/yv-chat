import type { MessagingGateway } from '../ports/messaging-gateway'

export class LeaveGroup {
  constructor(private readonly gateway: MessagingGateway) {}

  execute(conversationId: string): Promise<void> {
    if (!conversationId) throw new TypeError('conversation is required')
    return this.gateway.leaveGroup(conversationId)
  }
}
