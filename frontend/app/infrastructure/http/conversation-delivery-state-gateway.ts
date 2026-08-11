import type {
  ConversationDeliveryStateGateway,
  MarkConversationDeliveredResult,
} from '../../application/ports/conversation-delivery-state-gateway'
import type { ParticipantDeliveryState } from '../../domain/messaging/models'
import type { ApiClient } from './api-client'
import {
  parseMarkConversationDeliveredResult,
  parseParticipantDeliveryStates,
} from './conversation-delivery-state-parsers'

export class HttpConversationDeliveryStateGateway implements ConversationDeliveryStateGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async list(): Promise<ParticipantDeliveryState[]> {
    return parseParticipantDeliveryStates(
      await this.apiClient.request('/api/v1/conversation-delivery-states'),
    )
  }

  async mark(conversationId: string, sequence: number): Promise<MarkConversationDeliveredResult> {
    return parseMarkConversationDeliveredResult(
      await this.apiClient.request(
        `/api/v1/conversation-delivery-states/${encodeURIComponent(conversationId)}`,
        { method: 'PUT', body: { sequence } },
      ),
    )
  }
}
