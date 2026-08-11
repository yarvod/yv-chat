import { apiRequest } from '../api'
import {
  parseConversation,
  parseConversations,
  parseDirectory,
  parseMessages,
  parseSyncPage,
} from './parsers'
import type { Conversation, DirectoryUser, OpaqueMessage, SyncPage } from './types'

export const directoryService = {
  async list(): Promise<DirectoryUser[]> {
    return parseDirectory(await apiRequest('/api/v1/users'))
  },
}

export const conversationService = {
  async list(): Promise<Conversation[]> {
    return parseConversations(await apiRequest('/api/v1/conversations'))
  },
  async createDirect(otherUserId: string): Promise<Conversation> {
    return parseConversation(await apiRequest('/api/v1/conversations/direct', {
      method: 'POST',
      body: { other_user_id: otherUserId },
    }))
  },
  async createGroup(title: string, memberUserIds: string[]): Promise<Conversation> {
    return parseConversation(await apiRequest('/api/v1/conversations/group', {
      method: 'POST',
      body: { title, member_user_ids: memberUserIds },
    }))
  },
}

export const messageService = {
  async list(conversationId: string, afterSequence = 0): Promise<OpaqueMessage[]> {
    const query = new URLSearchParams({ after_sequence: String(afterSequence), limit: '100' })
    return parseMessages(await apiRequest(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
    ))
  },
  async send(conversationId: string, clientMessageId: string, ciphertextBase64: string): Promise<void> {
    await apiRequest(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: {
        client_message_id: clientMessageId,
        protocol_version: 1,
        ciphertext_base64: ciphertextBase64,
      },
    })
  },
}

export const syncService = {
  async list(after: number): Promise<SyncPage> {
    const query = new URLSearchParams({ after: String(after), limit: '100' })
    return parseSyncPage(await apiRequest(`/api/v1/sync?${query}`))
  },
}
