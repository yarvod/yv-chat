import { describe, expect, it, vi } from 'vitest'

import { ConversationHistory } from '../app/application/messaging/conversation-history'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import type { MessageArchive } from '../app/application/ports/message-archive'
import type { MessageProtocolAdapter } from '../app/application/ports/message-protocol-adapter'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { OpaqueMessage } from '../app/domain/messaging/models'

const conversationId = 'conversation-retention'

function message(sequence: number): OpaqueMessage {
  return {
    messageId: `message-${sequence}`,
    clientMessageId: `client-${sequence}`,
    conversationId,
    senderUserId: 'user-bob',
    senderDeviceId: 'device-bob',
    protocolVersion: 2,
    cryptoGenerationId: 'generation-1',
    cryptoEpoch: 1,
    sequence,
    createdAt: '2026-08-13T12:00:00Z',
    expiresAt: '2026-09-12T12:00:00Z',
    ciphertextBase64: 'AQID',
    deletionReason: null,
    deletedAt: null,
  }
}

describe('retained history epoch drain', () => {
  it('decrypts forward pages in authoritative order before reconciliation can advance', async () => {
    const retained = Array.from({ length: 101 }, (_, index) => message(index + 1))
    const listMessages = vi.fn(async (_conversationId: string, afterSequence = 0) => (
      retained.filter(item => item.sequence > afterSequence).slice(0, 100)
    ))
    const decrypted: number[] = []
    const adapter: MessageProtocolAdapter = {
      protocolVersion: 2,
      secure: true,
      label: 'test MLS',
      protectText: async () => ({
        ciphertextBase64: 'AQID',
        cryptoGenerationId: 'generation-1',
        cryptoEpoch: 1,
      }),
      unprotectText: async input => {
        decrypted.push(Number(input.clientMessageId.slice('client-'.length)))
        return `message ${input.clientMessageId}`
      },
    }
    const put = vi.fn(async () => undefined)
    const gateway = { listMessages } as unknown as MessagingGateway
    const archive = {
      put,
      loadLatest: async () => [],
      loadBefore: async () => [],
      loadAfter: async () => [],
      close: () => undefined,
    } satisfies MessageArchive
    const history = new ConversationHistory(
      'user-alice',
      gateway,
      archive,
      new ProtocolMessageProtection([adapter]),
    )

    await history.cacheRetainedBeforeEpochAdvance(conversationId)

    expect(listMessages.mock.calls.map(call => call[1])).toEqual([0, 100])
    expect(decrypted).toEqual(Array.from({ length: 101 }, (_, index) => index + 1))
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('fails closed if a server page cannot make sequence progress', async () => {
    const gateway = {
      listMessages: vi.fn(async () => Array.from({ length: 100 }, () => message(1))),
    } as unknown as MessagingGateway
    const archive = {
      put: async () => undefined,
      loadLatest: async () => [],
      loadBefore: async () => [],
      loadAfter: async () => [],
      close: () => undefined,
    } satisfies MessageArchive
    const adapter: MessageProtocolAdapter = {
      protocolVersion: 2,
      secure: true,
      label: 'test MLS',
      protectText: async () => ({
        ciphertextBase64: 'AQID',
        cryptoGenerationId: 'generation-1',
        cryptoEpoch: 1,
      }),
      unprotectText: async () => 'message',
    }
    const history = new ConversationHistory(
      'user-alice',
      gateway,
      archive,
      new ProtocolMessageProtection([adapter]),
    )

    await expect(history.cacheRetainedBeforeEpochAdvance(conversationId))
      .rejects.toThrow('did not advance')
  })
})
