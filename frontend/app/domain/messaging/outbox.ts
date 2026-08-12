export type OutboxMessageStatus = 'pending' | 'sending' | 'sent' | 'failed'

export type OutboxFailureCode = 'conflict' | 'unauthorized' | 'forbidden' | 'rejected'

export interface OutboxMessage {
  ownerUserId: string
  senderDeviceId: string
  clientMessageId: string
  conversationId: string
  protocolVersion: number
  ciphertextBase64: string
  cryptoGenerationId: string | null
  cryptoEpoch: number | null
  attachmentIds?: readonly string[]
  status: OutboxMessageStatus
  attemptCount: number
  createdAt: string
  updatedAt: string
  nextAttemptAt: string | null
  failureCode: OutboxFailureCode | null
}
