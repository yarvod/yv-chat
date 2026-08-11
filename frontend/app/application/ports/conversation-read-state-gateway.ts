import type { ConversationReadState } from '../../domain/messaging/models'

export interface MarkConversationReadResult {
  conversationId: string
  lastReadSequence: number
  updatedAt: string
  advanced: boolean
}

export interface ConversationReadStateGateway {
  list(): Promise<ConversationReadState[]>
  mark(conversationId: string, sequence: number): Promise<MarkConversationReadResult>
}
