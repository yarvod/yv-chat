import { describe, expect, it } from 'vitest'

import type { TimelineMessage } from '../app/application/messaging/timeline-message'
import type { Conversation } from '../app/domain/messaging/models'
import { selectedMessageCopyText } from '../app/presentation/chat/selected-message-copy'

const conversation: Conversation = {
  conversationId: 'conversation-1',
  conversationType: 'direct',
  title: null,
  createdBy: 'alice-id',
  createdAt: '2026-08-22T00:00:00',
  updatedAt: '2026-08-22T00:00:00',
  members: [{
    userId: 'alice-id',
    username: 'alice',
    displayName: 'Алиса',
    role: 'member',
    joinedAt: '2026-08-22T00:00:00',
    leftAt: null,
  }, {
    userId: 'julia-id',
    username: 'julia',
    displayName: 'Юльчик ❤️❤️❤️',
    role: 'member',
    joinedAt: '2026-08-22T00:00:00',
    leftAt: null,
  }],
}

function message(sequence: number, displayBody: string, minute: string): TimelineMessage {
  return {
    messageId: `message-${sequence}`,
    clientMessageId: `client-${sequence}`,
    conversationId: conversation.conversationId,
    senderUserId: 'julia-id',
    senderDeviceId: 'julia-device',
    protocolVersion: 2,
    cryptoGenerationId: 'generation-1',
    cryptoEpoch: 1,
    sequence,
    createdAt: `2026-08-22T00:${minute}:00`,
    expiresAt: '2026-09-21T00:00:00',
    ciphertextBase64: 'b3BhcXVl',
    deletionReason: null,
    deletedAt: null,
    contentState: 'available',
    displayBody,
    contentSecure: true,
  }
}

describe('selected message copy text', () => {
  it('sorts messages and formats sender, local timestamp and text like Telegram', () => {
    const result = selectedMessageCopyText([
      message(3, 'а лучше из предпоследнего чатика', '40'),
      message(1, 'Пришли мне', '39'),
      message(2, 'а то я вижу только половину ответа', '39'),
    ], conversation)

    expect(result).toBe(
      'Юльчик ❤️❤️❤️, [22.08.2026 00:39]\nПришли мне\n\n'
      + 'Юльчик ❤️❤️❤️, [22.08.2026 00:39]\nа то я вижу только половину ответа\n\n'
      + 'Юльчик ❤️❤️❤️, [22.08.2026 00:40]\nа лучше из предпоследнего чатика',
    )
  })

  it('uses safe visible labels for media and excludes unavailable content', () => {
    const attachmentMessage: TimelineMessage = {
      ...message(2, '', '41'),
      displayAttachments: [{
        attachmentId: 'photo-1',
        kind: 'image',
        name: 'private-photo.jpg',
        contentType: 'image/jpeg',
        byteSize: 120,
      }, {
        attachmentId: 'document-1',
        kind: 'file',
        name: 'document.pdf',
        contentType: 'application/pdf',
        byteSize: 340,
      }],
    }
    const unavailable: TimelineMessage = {
      ...message(1, 'ciphertext must not be copied', '40'),
      contentState: 'unavailable',
    }

    expect(selectedMessageCopyText([attachmentMessage, unavailable], conversation)).toBe(
      'Юльчик ❤️❤️❤️, [22.08.2026 00:41]\n[Фото]\n[Файл: document.pdf]',
    )
  })
})
