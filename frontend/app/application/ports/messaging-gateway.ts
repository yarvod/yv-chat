import type {
  Conversation,
  DeleteMessageResult,
  DirectoryUser,
  MessageHistoryPage,
  MessageReactionSummary,
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
    cryptoGenerationId: string | null,
    cryptoEpoch: number | null,
    attachmentIds?: readonly string[],
  ): Promise<SendMessageReceipt>
  deleteMessage(conversationId: string, messageId: string): Promise<DeleteMessageResult>
  listMessageReactions?(
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<MessageReactionSummary[]>
  setMessageReaction?(
    conversationId: string,
    messageId: string,
    reaction: string,
    active: boolean,
  ): Promise<MessageReactionSummary[]>
  listSync(after: number): Promise<SyncPage>
}
