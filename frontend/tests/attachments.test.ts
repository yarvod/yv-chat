import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import {
  decodeGroupMessageContent,
  encodeGroupMessageContent,
} from '../app/application/messaging/group-message-content'
import { UploadGroupAttachment } from '../app/application/messaging/upload-group-attachment'
import type { AttachmentGateway } from '../app/application/ports/attachment-gateway'
import MessageAttachments from '../app/components/chat/MessageAttachments.vue'

const attachment = {
  attachmentId: 'attachment-1',
  kind: 'image' as const,
  name: 'photo.png',
  contentType: 'image/png',
  byteSize: 321,
}

describe('group message attachment content', () => {
  it('round-trips bounded metadata while preserving legacy text messages', () => {
    const encoded = encodeGroupMessageContent({ text: 'caption', attachments: [attachment] })

    expect(decodeGroupMessageContent(encoded)).toEqual({
      text: 'caption',
      attachments: [attachment],
    })
    expect(decodeGroupMessageContent('legacy group text')).toEqual({
      text: 'legacy group text',
      attachments: [],
    })
    expect(decodeGroupMessageContent('yv-chat/group-content/v1:{broken')).toEqual({
      text: 'yv-chat/group-content/v1:{broken',
      attachments: [],
    })
  })

  it('rejects an empty content envelope', () => {
    expect(() => encodeGroupMessageContent({ text: ' ', attachments: [] })).toThrow(TypeError)
  })
})

describe('group attachment upload use case', () => {
  it('normalizes display name and rejects direct-chat downgrade', async () => {
    const upload = vi.fn<AttachmentGateway['upload']>(async (conversationId, source) => ({
      attachmentId: 'server-attachment',
      clientAttachmentId: source.clientAttachmentId,
      conversationId,
      kind: source.kind,
      contentType: source.contentType,
      byteSize: source.byteSize,
      sha256Digest: 'a'.repeat(64),
      createdAt: '2026-08-12T12:00:00Z',
      expiresAt: '2026-08-13T12:00:00Z',
    }))
    const useCase = new UploadGroupAttachment(
      { upload },
      { create: () => 'client-attachment' },
    )
    const body = new Blob(['image'], { type: 'image/png' })

    const source = {
      name: `../camera${String.fromCharCode(0)}.png`,
      type: 'image/png',
      size: body.size,
      body,
    }
    await expect(useCase.execute('group-1', 'group', source)).resolves.toMatchObject({
      attachmentId: 'server-attachment',
      name: 'camera.png',
      kind: 'image',
    })
    await useCase.execute('group-1', 'group', source)
    expect(upload.mock.calls[1]?.[1].clientAttachmentId).toBe('client-attachment')
    await expect(useCase.execute('direct-1', 'direct', {
      name: 'secret.png',
      type: 'image/png',
      size: body.size,
      body,
    })).rejects.toThrow('direct attachments require E2EE')
  })
})

describe('message attachment rendering', () => {
  it('renders authenticated same-origin photo and file actions', () => {
    const wrapper = mount(MessageAttachments, {
      props: {
        conversationId: 'conversation/1',
        attachments: [attachment, {
          attachmentId: 'file-1',
          kind: 'file',
          name: 'report.pdf',
          contentType: 'application/pdf',
          byteSize: 2048,
        }],
      },
    })

    expect(wrapper.get('img').attributes('src')).toContain('conversation%2F1')
    expect(wrapper.get('.message-file').attributes('download')).toBe('report.pdf')
    expect(wrapper.text()).toContain('2 КБ')
  })

  it('replaces a failed image with an expiry-safe state', async () => {
    const wrapper = mount(MessageAttachments, {
      props: { conversationId: 'conversation-1', attachments: [attachment] },
    })

    await wrapper.get('img').trigger('error')
    expect(wrapper.text()).toContain('срок хранения истёк')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
