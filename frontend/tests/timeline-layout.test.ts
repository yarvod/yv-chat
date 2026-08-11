import { describe, expect, it } from 'vitest'

import type { TimelineMessage } from '../app/application/messaging/timeline-message'
import { buildTimelineLayout } from '../app/presentation/chat/timeline-layout'

function message(
  messageId: string,
  senderUserId: string,
  createdAt: string,
): TimelineMessage {
  return {
    messageId,
    clientMessageId: `client-${messageId}`,
    conversationId: 'conversation-1',
    senderUserId,
    senderDeviceId: `device-${senderUserId}`,
    protocolVersion: 1,
    sequence: Number(messageId.slice(1)),
    createdAt,
    expiresAt: '2026-09-10T12:00:00Z',
    ciphertextBase64: 'b3BhcXVl',
    deletionReason: null,
    deletedAt: null,
    contentState: 'available',
    displayBody: messageId,
    contentSecure: false,
  }
}

describe('timeline presentation layout', () => {
  it('adds day separators and groups only nearby messages from the same sender', () => {
    const layout = buildTimelineLayout([
      message('m1', 'bob', '2026-08-11T12:00:00Z'),
      message('m2', 'bob', '2026-08-11T12:03:00Z'),
      message('m3', 'bob', '2026-08-11T12:10:00Z'),
      message('m4', 'alice', '2026-08-11T12:11:00Z'),
      message('m5', 'bob', '2026-08-12T09:00:00Z'),
    ], 'group', 'alice')

    expect(layout.map(item => item.kind)).toEqual([
      'day', 'message', 'message', 'message', 'message', 'day', 'message',
    ])
    const messages = layout.filter(item => item.kind === 'message')
    expect(messages.map(item => item.joinedToPrevious)).toEqual([
      false, true, false, false, false,
    ])
    expect(messages.map(item => item.showSender)).toEqual([
      true, false, true, false, true,
    ])
  })

  it('does not add sender labels to direct conversations', () => {
    const layout = buildTimelineLayout([
      message('m1', 'bob', '2026-08-11T12:00:00Z'),
    ], 'direct', 'alice')

    const item = layout.find(entry => entry.kind === 'message')
    expect(item?.kind === 'message' && item.showSender).toBe(false)
  })
})
