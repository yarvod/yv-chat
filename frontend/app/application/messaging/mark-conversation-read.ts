import type {
  ConversationReadStateGateway,
  MarkConversationReadResult,
} from '../ports/conversation-read-state-gateway'

export class MarkConversationRead {
  constructor(private readonly gateway: ConversationReadStateGateway) {}

  execute(conversationId: string, sequence: number): Promise<MarkConversationReadResult> {
    if (!conversationId || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new TypeError('conversation and positive sequence are required')
    }
    return this.gateway.mark(conversationId, sequence)
  }
}
