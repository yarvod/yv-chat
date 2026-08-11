import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import {
  MessageProtectionError,
  ProtocolMessageProtection,
} from '../app/application/messaging/message-protection'
import { prepareTimelineMessage } from '../app/application/messaging/timeline-message'
import { SyntheticMessageProtocol } from '../app/infrastructure/crypto/synthetic-message-protocol'
import { UnavailableMlsMessageProtocol } from '../app/infrastructure/crypto/unavailable-mls-message-protocol'
import {
  parseConversation,
  parseOpaqueMessage,
  parseSyncPage,
} from '../app/infrastructure/http/messaging-parsers'
import { parseConversationReadStates } from '../app/infrastructure/http/conversation-read-state-parsers'
import { parseParticipantDeliveryStates } from '../app/infrastructure/http/conversation-delivery-state-parsers'

const conversation = {
  conversation_id: 'conversation-1',
  conversation_type: 'direct',
  title: null,
  created_by: 'user-1',
  created_at: '2026-08-11T12:00:00Z',
  updated_at: '2026-08-11T12:00:00Z',
  members: [{
    user_id: 'user-1',
    username: 'alice',
    display_name: 'Alice',
    role: 'member',
    joined_at: '2026-08-11T12:00:00Z',
    left_at: null,
  }],
}

describe('messaging boundaries', () => {
  it('parses the explicit conversation shape and rejects an unknown enum', () => {
    expect(parseConversation(conversation).conversationType).toBe('direct')
    expect(() => parseConversation({ ...conversation, conversation_type: 'channel' }))
      .toThrow(ApplicationError)
  })

  it('rejects a malformed sync cursor', () => {
    expect(() => parseSyncPage({
      events: [],
      next_cursor: -1,
      stream_cursor: 0,
      has_more: false,
      reset_required: false,
    })).toThrow(ApplicationError)
    expect(() => parseSyncPage({
      events: [{
        event_id: 'event-1',
        cursor: 1,
        event_type: 'read_receipt',
        conversation_id: 'conversation-1',
        message_id: null,
        actor_user_id: null,
        read_sequence: 2,
        delivery_sequence: null,
        created_at: '2026-08-11T12:00:00Z',
      }],
      next_cursor: 1,
      stream_cursor: 1,
      has_more: false,
      reset_required: false,
    })).toThrow(ApplicationError)
  })

  it('labels the temporary protocol as insecure and round-trips unicode asynchronously', async () => {
    const plaintext = 'Привет 👋'
    const protection = new ProtocolMessageProtection(
      [new SyntheticMessageProtocol(), new UnavailableMlsMessageProtocol()],
      1,
    )
    const encrypted = await protection.protectText({
      conversationId: 'conversation-1',
      clientMessageId: 'client-1',
      plaintext,
    })
    expect(protection.secure).toBe(false)
    expect(encrypted.protocolVersion).toBe(1)
    await expect(protection.unprotectText(1, {
      conversationId: 'conversation-1',
      clientMessageId: 'client-1',
      ciphertextBase64: encrypted.ciphertextBase64,
    })).resolves.toEqual({ plaintext, secure: false })
  })

  it('fails closed for MLS, unknown versions and corrupt v1 without synthetic fallback', async () => {
    const synthetic = new SyntheticMessageProtocol()
    const decode = vi.spyOn(synthetic, 'unprotectText')
    const protection = new ProtocolMessageProtection(
      [synthetic, new UnavailableMlsMessageProtocol()],
      1,
    )
    const input = {
      conversationId: 'conversation-1',
      clientMessageId: 'client-1',
      ciphertextBase64: 'not-used',
    }

    await expect(protection.unprotectText(2, input)).rejects.toMatchObject({
      kind: 'provider-unavailable',
    })
    expect(decode).not.toHaveBeenCalled()
    await expect(protection.unprotectText(99, input)).rejects.toBeInstanceOf(
      MessageProtectionError,
    )
    expect(decode).not.toHaveBeenCalled()
    await expect(protection.unprotectText(1, {
      ...input,
      ciphertextBase64: '%%%invalid-base64%%%',
    })).rejects.toMatchObject({ kind: 'corrupt-envelope' })
    await expect(protection.unprotectText(1, {
      ...input,
      ciphertextBase64: 'aGVs bG8=',
    })).rejects.toMatchObject({ kind: 'corrupt-envelope' })
  })

  it('rejects ambiguous adapter registration and never decrypts tombstones', async () => {
    expect(() => new ProtocolMessageProtection(
      [new SyntheticMessageProtocol(), new SyntheticMessageProtocol()],
      1,
    )).toThrow('duplicate message protocol adapter')

    const synthetic = new SyntheticMessageProtocol()
    const decode = vi.spyOn(synthetic, 'unprotectText')
    const protection = new ProtocolMessageProtection([synthetic], 1)
    const timeline = await prepareTimelineMessage({
      messageId: 'message-deleted',
      clientMessageId: 'client-deleted',
      conversationId: 'conversation-1',
      senderUserId: 'alice-id',
      senderDeviceId: 'device-1',
      protocolVersion: 1,
      sequence: 3,
      createdAt: '2026-08-11T12:00:03Z',
      ciphertextBase64: null,
      expiresAt: '2026-09-10T12:00:03Z',
      deletionReason: 'manual',
      deletedAt: '2026-08-11T12:01:00Z',
    }, protection)

    expect(timeline.contentState).toBe('deleted')
    expect(decode).not.toHaveBeenCalled()
  })

  it('parses active envelopes and tombstones as disjoint shapes', () => {
    const base = {
      message_id: 'message-1',
      client_message_id: 'client-1',
      conversation_id: 'conversation-1',
      sender_user_id: 'alice-id',
      sender_device_id: 'device-1',
      protocol_version: 1,
      sequence: 1,
      created_at: '2026-08-11T12:00:00Z',
      expires_at: '2026-09-10T12:00:00Z',
    }
    expect(parseOpaqueMessage({
      ...base,
      ciphertext_base64: 'b3BhcXVl',
      deletion_reason: null,
      deleted_at: null,
    }).ciphertextBase64).toBe('b3BhcXVl')
    expect(parseOpaqueMessage({
      ...base,
      ciphertext_base64: null,
      deletion_reason: 'expired',
      deleted_at: '2026-09-10T12:00:00Z',
    }).deletionReason).toBe('expired')
    expect(() => parseOpaqueMessage({
      ...base,
      ciphertext_base64: null,
      deletion_reason: null,
      deleted_at: null,
    })).toThrow(ApplicationError)
  })

  it('parses bounded read summaries and rejects negative counts', () => {
    expect(parseConversationReadStates([{
      conversation_id: 'conversation-1',
      last_read_sequence: 2,
      latest_sequence: 4,
      unread_count: 2,
    }])).toEqual([{
      conversationId: 'conversation-1',
      lastReadSequence: 2,
      latestSequence: 4,
      unreadCount: 2,
    }])
    expect(() => parseConversationReadStates([{
      conversation_id: 'conversation-1',
      last_read_sequence: 0,
      latest_sequence: 0,
      unread_count: -1,
    }])).toThrow(ApplicationError)
  })

  it('parses positive delivery summaries and rejects zero cursors', () => {
    expect(parseParticipantDeliveryStates([{
      conversation_id: 'conversation-1',
      user_id: 'bob-id',
      delivered_sequence: 4,
    }])).toEqual([{
      conversationId: 'conversation-1',
      userId: 'bob-id',
      deliveredSequence: 4,
    }])
    expect(() => parseParticipantDeliveryStates([{
      conversation_id: 'conversation-1',
      user_id: 'bob-id',
      delivered_sequence: 0,
    }])).toThrow(ApplicationError)
  })
})
