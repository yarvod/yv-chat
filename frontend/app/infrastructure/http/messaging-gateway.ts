import type { MessagingGateway } from '../../application/ports/messaging-gateway'
import type {
  Conversation,
  DeleteMessageResult,
  DirectoryUser,
  MessageHistoryPage,
  MessageReactionSummary,
  MessagePinSummary,
  OpaqueMessage,
  SendMessageReceipt,
  SyncPage,
} from '../../domain/messaging/models'
import type { ApiClient } from './api-client'
import {
  parseConversation,
  parseConversations,
  parseDeleteMessageResult,
  parseDirectory,
  parseMessages,
  parseMessageHistoryPage,
  parseMessageReactions,
  parseMessagePins,
  parseOpaqueMessage,
  parseSendMessageReceipt,
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

  async renameGroup(conversationId: string, title: string): Promise<Conversation> {
    return parseConversation(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'PATCH', body: { title } },
    ))
  }

  async addGroupMember(conversationId: string, userId: string): Promise<Conversation> {
    return parseConversation(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members`,
      { method: 'POST', body: { user_id: userId } },
    ))
  }

  async removeGroupMember(conversationId: string, userId: string): Promise<Conversation> {
    return parseConversation(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ))
  }

  async leaveGroup(conversationId: string): Promise<void> {
    await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/leave`,
      { method: 'POST' },
    )
  }

  async listMessages(conversationId: string, afterSequence = 0): Promise<OpaqueMessage[]> {
    const query = new URLSearchParams({ after_sequence: String(afterSequence), limit: '100' })
    return parseMessages(await this.apiClient.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query}`))
  }

  async listMessageHistory(
    conversationId: string,
    beforeSequence?: number,
    limit = 100,
  ): Promise<MessageHistoryPage> {
    const query = new URLSearchParams({ limit: String(limit) })
    if (beforeSequence !== undefined) query.set('before_sequence', String(beforeSequence))
    return parseMessageHistoryPage(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/history?${query}`,
    ))
  }

  async getMessage(conversationId: string, messageId: string): Promise<OpaqueMessage> {
    return parseOpaqueMessage(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/messages/${encodeURIComponent(messageId)}`,
    ))
  }

  async sendMessage(
    conversationId: string,
    clientMessageId: string,
    protocolVersion: number,
    ciphertextBase64: string,
    cryptoGenerationId: string | null,
    cryptoEpoch: number | null,
    attachmentIds: readonly string[] = [],
  ): Promise<SendMessageReceipt> {
    return parseSendMessageReceipt(await this.apiClient.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: {
        client_message_id: clientMessageId,
        protocol_version: protocolVersion,
        ciphertext_base64: ciphertextBase64,
        crypto_generation_id: cryptoGenerationId,
        crypto_epoch: cryptoEpoch,
        ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
      },
    }))
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

  async listMessageReactions(
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<MessageReactionSummary[]> {
    if (messageIds.length === 0) return []
    const query = new URLSearchParams()
    for (const messageId of messageIds.slice(0, 100)) query.append('message_ids', messageId)
    return parseMessageReactions(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/reactions?${query}`,
    ))
  }

  async setMessageReaction(
    conversationId: string,
    messageId: string,
    reaction: string,
    active: boolean,
  ): Promise<MessageReactionSummary[]> {
    return parseMessageReactions(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reaction)}`,
      { method: active ? 'PUT' : 'DELETE' },
    ))
  }

  async listMessagePins(conversationId: string): Promise<MessagePinSummary[]> {
    return parseMessagePins(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/pins`,
    ))
  }

  async setMessagePin(
    conversationId: string,
    messageId: string,
    active: boolean,
  ): Promise<MessagePinSummary[]> {
    return parseMessagePins(await this.apiClient.request(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`
      + `/messages/${encodeURIComponent(messageId)}/pin`,
      { method: active ? 'PUT' : 'DELETE' },
    ))
  }

  async listSync(after: number): Promise<SyncPage> {
    const query = new URLSearchParams({ after: String(after), limit: '100' })
    return parseSyncPage(await this.apiClient.request(`/api/v1/sync?${query}`))
  }
}
