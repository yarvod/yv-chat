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
  cryptoGenerationId: string | null
  cryptoEpoch: number | null
  sequence: number
  createdAt: string
  expiresAt: string
  ciphertextBase64: string | null
  deletionReason: MessageDeletionReason | null
  deletedAt: string | null
}

export type MessageAttachmentKind = 'image' | 'video' | 'file'

export interface MessageAttachment {
  attachmentId: string
  kind: MessageAttachmentKind
  name: string
  contentType: string
  byteSize: number
  pixelWidth?: number
  pixelHeight?: number
  presentation?: 'video_note' | 'sticker'
  durationSeconds?: number
}

export interface SendMessageReceipt {
  messageId: string
  clientMessageId: string
  conversationId: string
  senderUserId: string
  senderDeviceId: string
  protocolVersion: number
  cryptoGenerationId: string | null
  cryptoEpoch: number | null
  sequence: number
  createdAt: string
  expiresAt: string
}

export interface MessageHistoryPage {
  messages: readonly OpaqueMessage[]
  hasMore: boolean
  oldestSequence: number | null
  newestSequence: number | null
}

export interface MessageReactionSummary {
  messageId: string
  reaction: string
  count: number
  reactedByActor: boolean
  actorUserIds: readonly string[]
}

export interface MessagePinSummary {
  messageId: string
  sequence: number
  pinnedByUserId: string
  pinnedAt: string
}

export type MessageDeletionReason = 'manual' | 'expired'

export interface DeleteMessageResult {
  messageId: string
  conversationId: string
  sequence: number
  deletionReason: MessageDeletionReason
  deletedAt: string
  advanced: boolean
}

export interface ConversationReadState {
  conversationId: string
  lastReadSequence: number
  latestSequence: number
  unreadCount: number
}

export interface ParticipantDeliveryState {
  conversationId: string
  userId: string
  deliveredSequence: number
}

export type SyncEventType =
  | 'conversation_updated'
  | 'message_created'
  | 'message_deleted'
  | 'message_reaction_updated'
  | 'message_pin_updated'
  | 'read_receipt'
  | 'delivery_receipt'

export interface SyncEvent {
  eventId: string
  cursor: number
  eventType: SyncEventType
  conversationId: string
  messageId: string | null
  actorUserId: string | null
  readSequence: number | null
  deliverySequence: number | null
  createdAt: string
}

export interface SyncPage {
  events: readonly SyncEvent[]
  nextCursor: number
  streamCursor: number
  hasMore: boolean
  resetRequired: boolean
}
