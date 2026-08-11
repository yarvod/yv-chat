import { describe, expect, it, vi } from 'vitest'

import type { ReconcileConversationCryptoResult } from '../app/application/conversation-crypto/reconcile-conversation-crypto'
import type {
  ProtectMlsMessageCommand,
  UnprotectMlsMessageCommand,
} from '../app/application/ports/mls-conversation-gateway'
import {
  MlsMessageProtocol,
  type MlsMessageSession,
} from '../app/infrastructure/crypto/mls-message-protocol'

const conversationId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const clientMessageId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'

function reconciled(status: 'blocked' | 'pending' | 'ready'): ReconcileConversationCryptoResult {
  return {
    status,
    generationId: 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd',
    generationNumber: 1,
    blockReason: status === 'blocked' ? 'missing_key_package' : null,
    epoch: status === 'ready' ? 1 : null,
  }
}

class FakeSession implements MlsMessageSession {
  readonly reconcileConversation = vi.fn(async () => reconciled('ready'))
  readonly protectMessage = vi.fn(async (_command: ProtectMlsMessageCommand) => ({
    ciphertext: new Uint8Array([1, 2, 3]),
    epoch: 1,
    revision: 4,
  }))

  readonly unprotectMessage = vi.fn(async (_command: UnprotectMlsMessageCommand) => ({
    plaintext: new TextEncoder().encode('привет'),
    revision: 5,
  }))
}

describe('MLS v2 message protocol adapter', () => {
  it('requires a ready generation and sends UTF-8 only through the Worker session', async () => {
    const session = new FakeSession()
    const protocol = new MlsMessageProtocol(session)

    await expect(protocol.protectText({
      conversationId,
      clientMessageId,
      plaintext: 'привет',
    })).resolves.toBe('AQID')
    expect(session.reconcileConversation).toHaveBeenCalledWith(conversationId)
    expect(session.protectMessage.mock.calls[0]?.[0].plaintext)
      .toEqual(new TextEncoder().encode('привет'))

    await expect(protocol.unprotectText({
      conversationId,
      clientMessageId,
      ciphertextBase64: 'AQID',
    })).resolves.toBe('привет')
    expect(session.unprotectMessage.mock.calls[0]?.[0].ciphertext)
      .toEqual(new Uint8Array([1, 2, 3]))
  })

  it('fails closed while bootstrap is pending and never falls back to v1', async () => {
    const session = new FakeSession()
    session.reconcileConversation.mockResolvedValue(reconciled('pending'))
    const protocol = new MlsMessageProtocol(session)

    await expect(protocol.protectText({ conversationId, clientMessageId, plaintext: 'secret' }))
      .rejects.toMatchObject({ kind: 'provider-unavailable' })
    expect(session.protectMessage).not.toHaveBeenCalled()
  })

  it('rejects a malformed transport envelope before it reaches OpenMLS', async () => {
    const session = new FakeSession()
    const protocol = new MlsMessageProtocol(session)
    await expect(protocol.unprotectText({
      conversationId,
      clientMessageId,
      ciphertextBase64: 'not base64',
    })).rejects.toMatchObject({ kind: 'corrupt-envelope' })
    expect(session.unprotectMessage).not.toHaveBeenCalled()
  })
})
