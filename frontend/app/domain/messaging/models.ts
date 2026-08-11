export interface DirectoryUser {
  userId: string
  username: string
  displayName: string
}

export type ConversationType = 'direct' | 'group'
export type ConversationRole = 'member' | 'admin' | 'owner'

export interface ConversationMember extends DirectoryUser {
  role: ConversationRole
  joinedAt: string
  leftAt: string | null
}

export interface Conversation {
  conversationId: string
  conversationType: ConversationType
  title: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  members: readonly ConversationMember[]
}

export interface OpaqueMessage {
  messageId: string
  clientMessageId: string
  conversationId: string
  senderUserId: string
  senderDeviceId: string
  protocolVersion: number
  sequence: number
  createdAt: string
  ciphertextBase64: string
}

export interface ConversationReadState {
  conversationId: string
  lastReadSequence: number
  latestSequence: number
  unreadCount: number
}

export type SyncEventType =
  | 'conversation_updated'
  | 'message_created'
  | 'message_deleted'
  | 'read_receipt'

export interface SyncEvent {
  eventId: string
  cursor: number
  eventType: SyncEventType
  conversationId: string
  messageId: string | null
  actorUserId: string | null
  readSequence: number | null
  createdAt: string
}

export interface SyncPage {
  events: readonly SyncEvent[]
  nextCursor: number
  streamCursor: number
  hasMore: boolean
  resetRequired: boolean
}
