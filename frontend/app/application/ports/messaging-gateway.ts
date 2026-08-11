import type {
  Conversation,
  DeleteMessageResult,
  DirectoryUser,
  MessageHistoryPage,
  OpaqueMessage,
  SendMessageReceipt,
  SyncPage,
} from '../../domain/messaging/models'

export interface MessagingGateway {
  listDirectory(): Promise<DirectoryUser[]>
  listConversations(): Promise<Conversation[]>
  createDirect(otherUserId: string): Promise<Conversation>
  createGroup(title: string, memberUserIds: string[]): Promise<Conversation>
  renameGroup(conversationId: string, title: string): Promise<Conversation>
  addGroupMember(conversationId: string, userId: string): Promise<Conversation>
  removeGroupMember(conversationId: string, userId: string): Promise<Conversation>
  leaveGroup(conversationId: string): Promise<void>
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
  ): Promise<SendMessageReceipt>
  deleteMessage(conversationId: string, messageId: string): Promise<DeleteMessageResult>
  listSync(after: number): Promise<SyncPage>
}
