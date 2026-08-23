import { describe, expect, it, vi } from 'vitest'

import { ConversationHistory } from '../app/application/messaging/conversation-history'
import { encodeGroupMessageContent } from '../app/application/messaging/group-message-content'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import type { MessageArchive } from '../app/application/ports/message-archive'
import type { MessageProtocolAdapter } from '../app/application/ports/message-protocol-adapter'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { OpaqueMessage } from '../app/domain/messaging/models'

function message(sequence: number, plaintext: string): OpaqueMessage {
  return {
    messageId: `message-${sequence}`,
    clientMessageId: `client-${sequence}`,
    conversationId: 'conversation-media',
    senderUserId: sequence === 1 ? 'alice-id' : 'bob-id',
    senderDeviceId: `device-${sequence}`,
    protocolVersion: 1,
    cryptoGenerationId: null,
    cryptoEpoch: null,
    sequence,
    createdAt: `2026-08-23T12:00:0${sequence}Z`,
    expiresAt: '2026-09-22T12:00:00Z',
    ciphertextBase64: plaintext,
    deletionReason: null,
    deletedAt: null,
  }
}

describe('conversation media index', () => {
  it('decodes attachment metadata client-side and returns newest items first', async () => {
    const plaintextByClientId = new Map([
      ['client-1', encodeGroupMessageContent({
        text: '',
        attachments: [{
          attachmentId: 'photo-1',
          kind: 'image',
          name: 'photo.jpg',
          contentType: 'image/jpeg',
          byteSize: 123,
        }],
      })],
      ['client-2', encodeGroupMessageContent({
        text: '',
        attachments: [{
          attachmentId: 'file-2',
          kind: 'file',
          name: 'notes.pdf',
          contentType: 'application/pdf',
          byteSize: 456,
        }],
      })],
    ])
    const adapter: MessageProtocolAdapter = {
      protocolVersion: 1,
      secure: false,
      label: 'synthetic',
      protectText: async input => ({ ciphertextBase64: input.plaintext }),
      unprotectText: async input => plaintextByClientId.get(input.clientMessageId) ?? '',
    }
    const messages = [
      message(1, plaintextByClientId.get('client-1')!),
      message(2, plaintextByClientId.get('client-2')!),
    ]
    const gateway = {
      listMessageHistory: vi.fn().mockResolvedValue({
        messages,
        hasMore: false,
        oldestSequence: 1,
        newestSequence: 2,
      }),
    } as unknown as MessagingGateway
    const archive = {
      loadLatest: async () => [],
      loadBefore: async () => [],
      loadAfter: async () => [],
      put: async () => undefined,
      close: () => undefined,
    } satisfies MessageArchive
    const history = new ConversationHistory(
      'alice-id',
      gateway,
      archive,
      new ProtocolMessageProtection([adapter]),
    )

    const index = await history.listMedia('conversation-media')

    expect(index.truncated).toBe(false)
    expect(index.items.map(item => [item.messageId, item.attachment.name])).toEqual([
      ['message-2', 'notes.pdf'],
      ['message-1', 'photo.jpg'],
    ])
  })
})
