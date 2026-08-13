import type { OpaqueMessage } from '../../domain/messaging/models'

/**
 * Device-local extension of the server envelope. The canonical plaintext is
 * only ever persisted inside the AES-GCM sealed archive record; it is not part
 * of any HTTP/WebSocket message DTO.
 */
export interface ArchivedMessage extends OpaqueMessage {
  localPlaintext?: string
}

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
  ): Promise<ArchivedMessage[]>
  loadBefore(
    ownerUserId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): Promise<ArchivedMessage[]>
  loadAfter(
    ownerUserId: string,
    conversationId: string,
    afterSequence: number,
    limit: number,
  ): Promise<ArchivedMessage[]>
  put(
    ownerUserId: string,
    conversationId: string,
    messages: readonly ArchivedMessage[],
  ): Promise<void>
  close(): void
}
