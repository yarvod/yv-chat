import { webcrypto } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  decodeDirectMessageContent,
  DirectAttachmentSecrets,
  encodeDirectMessageContent,
} from '../app/application/messaging/direct-message-content'
import { DownloadGroupAttachment } from '../app/application/messaging/download-group-attachment'
import { UploadDirectAttachment } from '../app/application/messaging/upload-direct-attachment'
import type { AttachmentGateway } from '../app/application/ports/attachment-gateway'
import { WebCryptoAttachmentCipher } from '../app/infrastructure/crypto/webcrypto-attachment-cipher'

const CONVERSATION_ID = 'conversation-1'
const CLIENT_ATTACHMENT_ID = 'client-attachment-1'
const ATTACHMENT_ID = 'attachment-1'

function cipher(): WebCryptoAttachmentCipher {
  return new WebCryptoAttachmentCipher(
    webcrypto.subtle as unknown as SubtleCrypto,
    array => webcrypto.getRandomValues(array),
  )
}

describe('direct attachment content', () => {
  it('round-trips a typed call summary without pretending it is message text', () => {
    const encoded = encodeDirectMessageContent({
      text: '',
      attachments: [],
      call: {
        callId: '60cf6877-9dd1-454e-86ac-f42303c7775a',
        outcome: 'completed',
        durationSeconds: 83,
      },
    })
    expect(decodeDirectMessageContent(encoded, CONVERSATION_ID)).toEqual({
      text: '',
      attachments: [],
      call: {
        callId: '60cf6877-9dd1-454e-86ac-f42303c7775a',
        outcome: 'completed',
        durationSeconds: 83,
      },
    })
    expect(() => encodeDirectMessageContent({
      text: 'hidden duplicate',
      attachments: [],
      call: { callId: 'call', outcome: 'missed', durationSeconds: 0 },
    })).toThrow('invalid direct message content')
  })

  it('keeps key material out of the display projection and supports old direct text', () => {
    const secrets = new DirectAttachmentSecrets()
    const encoded = encodeDirectMessageContent({
      text: 'caption',
      attachments: [{
        attachment: {
          attachmentId: ATTACHMENT_ID,
          kind: 'video',
          name: 'note.webm',
          contentType: 'video/webm',
          byteSize: 120,
          presentation: 'video_note',
          durationSeconds: 4,
        },
        secret: {
          clientAttachmentId: CLIENT_ATTACHMENT_ID,
          keyBase64: btoa('k'.repeat(32)),
          nonceBase64: btoa('n'.repeat(12)),
          ciphertextByteSize: 136,
        },
      }],
      replyToMessageId: 'message-1',
      mentionedUserIds: ['user-2'],
    })

    const decoded = decodeDirectMessageContent(encoded, CONVERSATION_ID, secrets)
    expect(decoded).toEqual({
      text: 'caption',
      attachments: [{
        attachmentId: ATTACHMENT_ID,
        kind: 'video',
        name: 'note.webm',
        contentType: 'video/webm',
        byteSize: 120,
        presentation: 'video_note',
        durationSeconds: 4,
      }],
      replyToMessageId: 'message-1',
      mentionedUserIds: ['user-2'],
    })
    expect(JSON.stringify(decoded)).not.toContain('keyBase64')
    expect(secrets.get(CONVERSATION_ID, ATTACHMENT_ID)).toMatchObject({
      clientAttachmentId: CLIENT_ATTACHMENT_ID,
      ciphertextByteSize: 136,
    })
    expect(decodeDirectMessageContent(
      'yv-chat/text-content/v1:{"text":"old","reply_to_message_id":null,"mentioned_user_ids":[]}',
      CONVERSATION_ID,
    )).toEqual({ text: 'old', replyToMessageId: null, mentionedUserIds: [], attachments: [] })
  })

  it('keeps sticker presentation inside the protected direct envelope', () => {
    const encoded = encodeDirectMessageContent({
      text: '',
      attachments: [{
        attachment: {
          attachmentId: ATTACHMENT_ID,
          kind: 'image',
          name: 'party.gif',
          contentType: 'image/gif',
          byteSize: 120,
          presentation: 'sticker',
        },
        secret: {
          clientAttachmentId: CLIENT_ATTACHMENT_ID,
          keyBase64: btoa('k'.repeat(32)),
          nonceBase64: btoa('n'.repeat(12)),
          ciphertextByteSize: 136,
        },
      }],
    })

    expect(decodeDirectMessageContent(encoded, CONVERSATION_ID).attachments[0]).toMatchObject({
      presentation: 'sticker',
      contentType: 'image/gif',
    })
    expect(encoded).not.toContain('party bytes')
  })

  it('fails closed without exposing protected metadata when the envelope is malformed', () => {
    const malformed = 'yv-chat/direct-content/v1:{"text":"","attachments":[]}'
    expect(() => decodeDirectMessageContent(malformed, CONVERSATION_ID))
      .toThrow('invalid direct message content')
  })
})

describe('direct attachment encryption', () => {
  it('round-trips AES-GCM and rejects ciphertext or AAD substitution', async () => {
    const adapter = cipher()
    const scope = {
      conversationId: CONVERSATION_ID,
      clientAttachmentId: CLIENT_ATTACHMENT_ID,
      kind: 'file' as const,
      contentType: 'application/pdf',
      plaintextBytes: 14,
    }
    const plaintext = new Blob(['private report'], { type: scope.contentType })
    const first = await adapter.encrypt(scope, plaintext)
    const second = await adapter.encrypt(scope, plaintext)

    expect(first.ciphertext.size).toBe(plaintext.size + 16)
    expect(first.keyBase64).not.toBe(second.keyBase64)
    expect(first.nonceBase64).not.toBe(second.nonceBase64)
    await expect(adapter.decrypt(
      scope,
      first.ciphertext,
      first.keyBase64,
      first.nonceBase64,
    )).resolves.toSatisfy(async (result: Blob) => (
      result.type === scope.contentType && await result.text() === 'private report'
    ))

    const tampered = new Uint8Array(await first.ciphertext.arrayBuffer())
    tampered[0] = (tampered[0] ?? 0) ^ 1
    await expect(adapter.decrypt(
      scope,
      new Blob([tampered], { type: 'application/octet-stream' }),
      first.keyBase64,
      first.nonceBase64,
    )).rejects.toThrow('attachment authentication failed')
    await expect(adapter.decrypt(
      { ...scope, conversationId: 'conversation-2' },
      first.ciphertext,
      first.keyBase64,
      first.nonceBase64,
    )).rejects.toThrow('attachment authentication failed')
  })

  it('uploads only ciphertext metadata and decrypts after authenticated download', async () => {
    const attachmentCipher = cipher()
    const secrets = new DirectAttachmentSecrets()
    let stored: Blob | null = null
    const upload = vi.fn<AttachmentGateway['upload']>(async (conversationId, source) => {
      stored = source.body
      return {
        attachmentId: ATTACHMENT_ID,
        clientAttachmentId: source.clientAttachmentId,
        conversationId,
        kind: source.kind,
        contentType: source.contentType,
        byteSize: source.byteSize,
        sha256Digest: 'a'.repeat(64),
        createdAt: '2026-08-16T12:00:00Z',
        expiresAt: '2026-09-15T12:00:00Z',
      }
    })
    const gateway: AttachmentGateway = {
      upload,
      download: vi.fn(async () => stored ?? new Blob()),
    }
    const useCase = new UploadDirectAttachment(
      gateway,
      attachmentCipher,
      secrets,
      { create: () => CLIENT_ATTACHMENT_ID },
    )
    const body = new Blob(['secret video'], { type: 'video/webm' })
    const descriptor = await useCase.execute(CONVERSATION_ID, {
      name: '../private.webm',
      type: 'video/webm',
      size: body.size,
      body,
      presentation: 'video_note',
      durationSeconds: 3,
    })

    expect(upload).toHaveBeenCalledWith(CONVERSATION_ID, expect.objectContaining({
      kind: 'file',
      contentType: 'application/octet-stream',
      byteSize: body.size + 16,
    }), undefined)
    expect(await stored?.text()).not.toContain('secret video')
    expect(descriptor.attachment).toMatchObject({
      kind: 'video',
      name: 'private.webm',
      contentType: 'video/webm',
      presentation: 'video_note',
    })

    const download = new DownloadGroupAttachment(
      gateway,
      undefined,
      1024,
      Date.now,
      attachmentCipher,
      secrets,
    )
    const decrypted = await download.execute(
      'user-1',
      'device-1',
      CONVERSATION_ID,
      descriptor.attachment,
      '2099-01-01T00:00:00Z',
    )
    expect(decrypted.type).toBe('video/webm')
    expect(await decrypted.text()).toBe('secret video')
  })
})
