import type { ParticipantDeliveryState } from '../../domain/messaging/models'

export interface MarkConversationDeliveredResult {
  conversationId: string
  lastDeliveredSequence: number
  updatedAt: string
  advanced: boolean
}

export interface ConversationDeliveryStateGateway {
  list(): Promise<ParticipantDeliveryState[]>
  mark(conversationId: string, sequence: number): Promise<MarkConversationDeliveredResult>
}
