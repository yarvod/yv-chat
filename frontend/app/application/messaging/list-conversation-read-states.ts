import type { ConversationReadStateGateway } from '../ports/conversation-read-state-gateway'
import type { ConversationReadState } from '../../domain/messaging/models'

export class ListConversationReadStates {
  constructor(private readonly gateway: ConversationReadStateGateway) {}

  execute(): Promise<ConversationReadState[]> {
    return this.gateway.list()
  }
}
