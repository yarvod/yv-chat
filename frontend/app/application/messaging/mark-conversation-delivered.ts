import type {
  ConversationDeliveryStateGateway,
  MarkConversationDeliveredResult,
} from '../ports/conversation-delivery-state-gateway'

export class MarkConversationDelivered {
  constructor(private readonly gateway: ConversationDeliveryStateGateway) {}

  execute(conversationId: string, sequence: number): Promise<MarkConversationDeliveredResult> {
    if (!conversationId || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new TypeError('conversation and positive sequence are required')
    }
    return this.gateway.mark(conversationId, sequence)
  }
}
