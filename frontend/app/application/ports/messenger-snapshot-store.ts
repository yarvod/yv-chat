import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'

export interface MessengerSnapshot {
  ownerUserId: string
  directory: readonly DirectoryUser[]
  conversations: readonly Conversation[]
  readStates: readonly ConversationReadState[]
  deliveryStates: readonly ParticipantDeliveryState[]
  syncCursor: number
  savedAt: string
}

export type MessengerSnapshotStoreErrorKind = 'corrupt' | 'storage-unavailable'

export class MessengerSnapshotStoreError extends Error {
  constructor(readonly kind: MessengerSnapshotStoreErrorKind) {
    super(`messenger snapshot store: ${kind}`)
    this.name = 'MessengerSnapshotStoreError'
  }
}

export interface MessengerSnapshotStore {
  load(ownerUserId: string): Promise<MessengerSnapshot | null>
  save(snapshot: MessengerSnapshot): Promise<void>
  close(): void
}
