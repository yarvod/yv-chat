import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { AcknowledgeOutboxMessage } from '../app/application/messaging/acknowledge-outbox-message'
import { DeliverOutboxMessage } from '../app/application/messaging/deliver-outbox-message'
import { ListOutboxMessages } from '../app/application/messaging/list-outbox-messages'
import { QueueOutgoingMessage } from '../app/application/messaging/queue-outgoing-message'
import { RetryOutboxMessage } from '../app/application/messaging/retry-outbox-message'
import type { Clock } from '../app/application/ports/clock'
import type { MessageOutbox } from '../app/application/ports/message-outbox'
import type { MessagingGateway } from '../app/application/ports/messaging-gateway'
import type { OutboxMessage } from '../app/domain/messaging/outbox'
import { ProtocolMessageProtection } from '../app/application/messaging/message-protection'
import { SyntheticMessageProtocol } from '../app/infrastructure/crypto/synthetic-message-protocol'
import { useMessageOutbox } from '../app/presentation/composables/useMessageOutbox'

function createMemoryOutbox() {
  const entries = new Map<string, OutboxMessage>()
  const key = (owner: string, device: string, client: string) => `${owner}:${device}:${client}`
  const outbox: MessageOutbox = {
    enqueue: vi.fn(async message => {
      entries.set(key(message.ownerUserId, message.senderDeviceId, message.clientMessageId), message)
    }),
    get: vi.fn(async (owner, device, clientId) => entries.get(key(owner, device, clientId)) ?? null),
    list: vi.fn(async (owner, device) => [...entries.values()].filter(
      message => message.ownerUserId === owner && message.senderDeviceId === device,
    )),
    replace: vi.fn(async message => {
      entries.set(key(message.ownerUserId, message.senderDeviceId, message.clientMessageId), message)
    }),
    remove: vi.fn(async (owner, device, clientId) => { entries.delete(key(owner, device, clientId)) }),
    close: vi.fn(),
  }
  return { entries, outbox }
}

function gateway(sendMessage: MessagingGateway['sendMessage']): MessagingGateway {
  return {
    listDirectory: vi.fn(),
    listConversations: vi.fn(),
    createDirect: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    leaveGroup: vi.fn(),
    listMessages: vi.fn(),
    listMessageHistory: vi.fn(),
    getMessage: vi.fn(),
    sendMessage,
    deleteMessage: vi.fn(),
    listSync: vi.fn(),
  }
}

const receipt = {
  messageId: 'message-1',
  clientMessageId: 'client-fixed',
  conversationId: 'conversation-1',
  senderUserId: 'user-1',
  senderDeviceId: 'device-1',
  protocolVersion: 1,
  cryptoGenerationId: null,
  cryptoEpoch: null,
  sequence: 7,
  createdAt: '2026-08-11T12:00:01Z',
  expiresAt: '2026-09-10T12:00:01Z',
}

describe('message outbox use cases', () => {
  it('preserves per-conversation order while allowing another conversation to flush', async () => {
    const { entries, outbox } = createMemoryOutbox()
    const clock: Clock = { nowMilliseconds: () => Date.parse('2026-08-11T12:00:01Z') }
    const protection = new ProtocolMessageProtection([new SyntheticMessageProtocol()], 1)
    const messages: OutboxMessage[] = [{
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      clientMessageId: 'client-blocked',
      conversationId: 'conversation-1',
      protocolVersion: 1,
      ciphertextBase64: 'Zmlyc3Q=',
      cryptoGenerationId: null,
      cryptoEpoch: null,
      status: 'pending',
      attemptCount: 1,
      createdAt: '2026-08-11T12:00:00Z',
      updatedAt: '2026-08-11T12:00:00Z',
      nextAttemptAt: '2026-08-11T12:00:02Z',
      failureCode: null,
    }, {
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      clientMessageId: 'client-later',
      conversationId: 'conversation-1',
      protocolVersion: 1,
      ciphertextBase64: 'c2Vjb25k',
      cryptoGenerationId: null,
      cryptoEpoch: null,
      status: 'pending',
      attemptCount: 0,
      createdAt: '2026-08-11T12:00:00.001Z',
      updatedAt: '2026-08-11T12:00:00.001Z',
      nextAttemptAt: null,
      failureCode: null,
    }, {
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      clientMessageId: 'client-other',
      conversationId: 'conversation-2',
      protocolVersion: 1,
      ciphertextBase64: 'b3RoZXI=',
      cryptoGenerationId: null,
      cryptoEpoch: null,
      status: 'pending',
      attemptCount: 0,
      createdAt: '2026-08-11T12:00:00.002Z',
      updatedAt: '2026-08-11T12:00:00.002Z',
      nextAttemptAt: null,
      failureCode: null,
    }]
    for (const message of messages) await outbox.enqueue(message)
    const send = vi.fn(async (
      conversationId: string,
      clientMessageId: string,
      protocolVersion: number,
    ) => ({
      ...receipt,
      clientMessageId,
      conversationId,
      protocolVersion,
      sequence: 1,
    }))
    const reconcile = vi.fn().mockResolvedValue(undefined)
    const controller = useMessageOutbox('user-1', 'device-1', {
      messageProtection: protection,
      haptics: { isEnabled: () => true, setEnabled: vi.fn(), perform: vi.fn() },
      listOutboxMessages: new ListOutboxMessages(outbox),
      queueOutgoingMessage: new QueueOutgoingMessage(
        outbox, protection, { create: () => 'unused' }, clock,
      ),
      deliverOutboxMessage: new DeliverOutboxMessage(outbox, gateway(send), clock),
      acknowledgeOutboxMessage: new AcknowledgeOutboxMessage(outbox),
      retryOutboxMessage: new RetryOutboxMessage(outbox, clock),
    }, {
      reconcile,
      unauthorized: vi.fn(),
      failed: vi.fn(),
    })

    await controller.load()
    await controller.flush()

    expect(send).not.toHaveBeenCalledWith(
      'conversation-1', 'client-later', 1, expect.any(String),
    )
    expect(send).toHaveBeenCalledWith(
      'conversation-2', 'client-other', 1, 'b3RoZXI=',
      null, null,
    )
    expect([...entries.values()].some(item => item.clientMessageId === 'client-blocked')).toBe(true)
    expect([...entries.values()].some(item => item.clientMessageId === 'client-later')).toBe(true)
    expect([...entries.values()].some(item => item.clientMessageId === 'client-other')).toBe(false)
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('persists one protected immutable envelope before delivery and retries it exactly', async () => {
    const { entries, outbox } = createMemoryOutbox()
    let now = Date.parse('2026-08-11T12:00:00Z')
    const clock: Clock = { nowMilliseconds: () => now }
    const protection = new ProtocolMessageProtection([new SyntheticMessageProtocol()], 1)
    const queued = await new QueueOutgoingMessage(
      outbox,
      protection,
      { create: () => 'client-fixed' },
      clock,
    ).execute({
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      conversationId: 'conversation-1',
      plaintext: '  private draft  ',
    })
    expect(entries.get('user-1:device-1:client-fixed')).toEqual(queued)
    expect(queued).toMatchObject({
      clientMessageId: 'client-fixed',
      ciphertextBase64: 'cHJpdmF0ZSBkcmFmdA==',
      status: 'pending',
      attemptCount: 0,
    })

    const send = vi.fn()
      .mockRejectedValueOnce(new ApplicationError(null, 'network', 'offline'))
      .mockResolvedValueOnce(receipt)
    const deliver = new DeliverOutboxMessage(outbox, gateway(send), clock)
    const first = await deliver.execute(queued)
    expect(first.kind).toBe('retryable')
    expect(first.message).toMatchObject({
      clientMessageId: 'client-fixed',
      ciphertextBase64: queued.ciphertextBase64,
      status: 'pending',
      attemptCount: 1,
      nextAttemptAt: '2026-08-11T12:00:01.000Z',
    })

    expect((await deliver.execute(first.message)).kind).toBe('deferred')
    now += 1_000
    const second = await deliver.execute(first.message)
    expect(second).toMatchObject({ kind: 'sent', receipt })
    expect(send).toHaveBeenNthCalledWith(
      1, 'conversation-1', 'client-fixed', 1, queued.ciphertextBase64,
      null, null,
    )
    expect(send).toHaveBeenNthCalledWith(
      2, 'conversation-1', 'client-fixed', 1, queued.ciphertextBase64,
      null, null,
    )
  })

  it('recovers persisted sending after a crash and treats a mismatched receipt as retryable', async () => {
    const { outbox } = createMemoryOutbox()
    const clock: Clock = { nowMilliseconds: () => Date.parse('2026-08-11T12:00:10Z') }
    const sending: OutboxMessage = {
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      clientMessageId: 'client-fixed',
      conversationId: 'conversation-1',
      protocolVersion: 1,
      ciphertextBase64: 'Y2lwaGVydGV4dA==',
      cryptoGenerationId: null,
      cryptoEpoch: null,
      status: 'sending',
      attemptCount: 1,
      createdAt: '2026-08-11T12:00:00Z',
      updatedAt: '2026-08-11T12:00:01Z',
      nextAttemptAt: null,
      failureCode: null,
    }
    await outbox.enqueue(sending)
    const send = vi.fn().mockResolvedValue({ ...receipt, conversationId: 'other' })
    const result = await new DeliverOutboxMessage(outbox, gateway(send), clock).execute(sending)

    expect(result.kind).toBe('retryable')
    expect(result.message).toMatchObject({ status: 'pending', attemptCount: 2 })
    expect(send).toHaveBeenCalledWith(
      'conversation-1', 'client-fixed', 1, 'Y2lwaGVydGV4dA==',
      null, null,
    )
  })

  it('keeps permanent conflicts visible until an explicit manual retry', async () => {
    const { outbox } = createMemoryOutbox()
    const clock: Clock = { nowMilliseconds: () => Date.parse('2026-08-11T12:00:10Z') }
    const pending: OutboxMessage = {
      ownerUserId: 'user-1',
      senderDeviceId: 'device-1',
      clientMessageId: 'client-fixed',
      conversationId: 'conversation-1',
      protocolVersion: 1,
      ciphertextBase64: 'Y2lwaGVydGV4dA==',
      cryptoGenerationId: null,
      cryptoEpoch: null,
      status: 'pending',
      attemptCount: 0,
      createdAt: '2026-08-11T12:00:00Z',
      updatedAt: '2026-08-11T12:00:00Z',
      nextAttemptAt: null,
      failureCode: null,
    }
    await outbox.enqueue(pending)
    const send = vi.fn().mockRejectedValue(new ApplicationError(409, 'http', 'conflict'))
    const failed = await new DeliverOutboxMessage(outbox, gateway(send), clock).execute(pending)
    expect(failed.message).toMatchObject({ status: 'failed', failureCode: 'conflict' })

    const retried = await new RetryOutboxMessage(outbox, clock).execute(
      'user-1',
      'device-1',
      'client-fixed',
    )
    expect(retried).toMatchObject({
      clientMessageId: 'client-fixed',
      ciphertextBase64: pending.ciphertextBase64,
      status: 'pending',
      failureCode: null,
    })
  })
})
