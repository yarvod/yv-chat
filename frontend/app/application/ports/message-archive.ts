import type { OpaqueMessage } from '../../domain/messaging/models'

export type MessageArchiveErrorKind = 'corrupt' | 'storage-unavailable'

export class MessageArchiveError extends Error {
  constructor(readonly kind: MessageArchiveErrorKind) {
    super('encrypted message archive operation failed')
    this.name = 'MessageArchiveError'
  }
}

export interface MessageArchive {
  loadLatest(
    ownerUserId: string,
    conversationId: string,
    limit: number,
  ): Promise<OpaqueMessage[]>
  loadBefore(
    ownerUserId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): Promise<OpaqueMessage[]>
  put(
    ownerUserId: string,
    conversationId: string,
    messages: readonly OpaqueMessage[],
  ): Promise<void>
  close(): void
}
