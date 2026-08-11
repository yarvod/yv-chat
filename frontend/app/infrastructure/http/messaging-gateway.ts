import type { MessagingGateway } from '../../application/ports/messaging-gateway'
import type {
  Conversation,
  DeleteMessageResult,
  DirectoryUser,
  OpaqueMessage,
  SyncPage,
} from '../../domain/messaging/models'
import type { ApiClient } from './api-client'
import {
  parseConversation,
  parseConversations,
  parseDeleteMessageResult,
  parseDirectory,
  parseMessages,
  parseSyncPage,
} from './messaging-parsers'

export class HttpMessagingGateway implements MessagingGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async listDirectory(): Promise<DirectoryUser[]> {
    return parseDirectory(await this.apiClient.request('/api/v1/users'))
  }

  async listConversations(): Promise<Conversation[]> {
    return parseConversations(await this.apiClient.request('/api/v1/conversations'))
  }

  async createDirect(otherUserId: string): Promise<Conversation> {
    return parseConversation(await this.apiClient.request('/api/v1/conversations/direct', {
      method: 'POST', body: { other_user_id: otherUserId },
    }))
  }

  async createGroup(title: string, memberUserIds: string[]): Promise<Conversation> {
    return parseConversation(await this.apiClient.request('/api/v1/conversations/group', {
      method: 'POST', body: { title, member_user_ids: memberUserIds },
    }))
  }

  async listMessages(conversationId: string, afterSequence = 0): Promise<OpaqueMessage[]> {
    const query = new URLSearchParams({ after_sequence: String(afterSequence), limit: '100' })
    return parseMessages(await this.apiClient.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query}`))
  }

  async sendMessage(
    conversationId: string,
    clientMessageId: string,
    protocolVersion: number,
    ciphertextBase64: string,
  ): Promise<void> {
    await this.apiClient.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: {
        client_message_id: clientMessageId,
        protocol_version: protocolVersion,
        ciphertext_base64: ciphertextBase64,
      },
    })
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<DeleteMessageResult> {
    return parseDeleteMessageResult(
      await this.apiClient.request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      ),
    )
  }

  async listSync(after: number): Promise<SyncPage> {
    const query = new URLSearchParams({ after: String(after), limit: '100' })
    return parseSyncPage(await this.apiClient.request(`/api/v1/sync?${query}`))
  }
}
