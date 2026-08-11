import type {
  ConversationReadStateGateway,
  MarkConversationReadResult,
} from '../../application/ports/conversation-read-state-gateway'
import type { ConversationReadState } from '../../domain/messaging/models'
import type { ApiClient } from './api-client'
import {
  parseConversationReadStates,
  parseMarkConversationReadResult,
} from './conversation-read-state-parsers'

export class HttpConversationReadStateGateway implements ConversationReadStateGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async list(): Promise<ConversationReadState[]> {
    return parseConversationReadStates(
      await this.apiClient.request('/api/v1/conversation-read-states'),
    )
  }

  async mark(conversationId: string, sequence: number): Promise<MarkConversationReadResult> {
    return parseMarkConversationReadResult(
      await this.apiClient.request(
        `/api/v1/conversation-read-states/${encodeURIComponent(conversationId)}`,
        { method: 'PUT', body: { sequence } },
      ),
    )
  }
}
