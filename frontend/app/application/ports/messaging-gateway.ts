import type {
  Conversation,
  DeleteMessageResult,
  DirectoryUser,
  MessageHistoryPage,
  OpaqueMessage,
  SyncPage,
} from '../../domain/messaging/models'

export interface MessagingGateway {
  listDirectory(): Promise<DirectoryUser[]>
  listConversations(): Promise<Conversation[]>
  createDirect(otherUserId: string): Promise<Conversation>
  createGroup(title: string, memberUserIds: string[]): Promise<Conversation>
  listMessages(conversationId: string, afterSequence?: number): Promise<OpaqueMessage[]>
  listMessageHistory(
    conversationId: string,
    beforeSequence?: number,
    limit?: number,
  ): Promise<MessageHistoryPage>
  getMessage(conversationId: string, messageId: string): Promise<OpaqueMessage>
  sendMessage(
    conversationId: string,
    clientMessageId: string,
    protocolVersion: number,
    ciphertextBase64: string,
  ): Promise<void>
  deleteMessage(conversationId: string, messageId: string): Promise<DeleteMessageResult>
  listSync(after: number): Promise<SyncPage>
}
