export type ConversationCryptoLocalPhase =
  | 'bootstrap-requested'
  | 'coordinator-checkpointed'
  | 'coordinator-update-checkpointed'
  | 'joined'
  | 'commit-applied'
  | 'ready'

export interface ConversationCryptoLocalState {
  readonly ownerDeviceId: string
  readonly conversationId: string
  readonly bootstrapRequestId: string
  readonly generationId: string | null
  readonly generationNumber: number | null
  readonly phase: ConversationCryptoLocalPhase
  readonly epoch: number | null
  readonly commit: Uint8Array | null
  readonly ratchetTree: Uint8Array | null
  readonly welcome: Uint8Array | null
  readonly targetDeviceIds: readonly string[]
  readonly updatedAt: string
}

export type ConversationCryptoStateErrorKind = 'corrupt' | 'storage-unavailable'

export class ConversationCryptoStateError extends Error {
  constructor(readonly kind: ConversationCryptoStateErrorKind) {
    super(`conversation crypto state: ${kind}`)
    this.name = 'ConversationCryptoStateError'
  }
}

export interface ConversationCryptoStateRepository {
  load(ownerDeviceId: string, conversationId: string): Promise<ConversationCryptoLocalState | null>
  save(state: ConversationCryptoLocalState): Promise<void>
  close(): void
}
