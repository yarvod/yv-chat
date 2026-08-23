import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ConversationDetailsPanel from '../app/components/chat/ConversationDetailsPanel.vue'

const conversation = {
  conversationId: 'group-1',
  conversationType: 'group' as const,
  title: 'Core team',
  createdBy: 'owner-id',
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  members: [
    { userId: 'owner-id', username: 'owner', displayName: 'Owner', role: 'owner' as const, joinedAt: '2026-08-11T12:00:00Z', leftAt: null },
    { userId: 'member-id', username: 'member', displayName: 'Member', role: 'member' as const, joinedAt: '2026-08-11T12:00:00Z', leftAt: null },
  ],
}

function mountPanel(actorUserId = 'owner-id') {
  return mount(ConversationDetailsPanel, {
    props: {
      conversation,
      directory: [
        { userId: 'owner-id', username: 'owner', displayName: 'Owner' },
        { userId: 'member-id', username: 'member', displayName: 'Member' },
        { userId: 'new-id', username: 'new', displayName: 'New person' },
      ],
      actorUserId,
      online: false,
      busy: false,
      notice: null,
      mediaItems: [],
      mediaLoading: false,
      mediaTruncated: false,
      reloadMedia: vi.fn().mockResolvedValue(undefined),
      loadAttachment: vi.fn(),
      openMessage: vi.fn().mockResolvedValue(undefined),
      renameGroup: vi.fn().mockResolvedValue(true),
      addMember: vi.fn().mockResolvedValue(true),
      removeMember: vi.fn().mockResolvedValue(true),
      leaveGroup: vi.fn().mockResolvedValue(true),
    },
  })
}

describe('group details panel', () => {
  it('lets an owner rename, add and explicitly confirm removal', async () => {
    const wrapper = mountPanel()
    await wrapper.get('.conversation-details-tabs button:last-child').trigger('click')
    await wrapper.get('#group-title').setValue('Renamed team')
    await wrapper.get('.group-title-form').trigger('submit')
    expect(wrapper.props('renameGroup')).toHaveBeenCalledWith('Renamed team')

    await wrapper.get('#group-add-user').setValue('new-id')
    await wrapper.get('.group-add-member').trigger('submit')
    expect(wrapper.props('addMember')).toHaveBeenCalledWith('new-id')

    await wrapper.get('.group-member-actions > button').trigger('click')
    expect(wrapper.text()).toContain('Удалить')
    await wrapper.get('.group-member-actions .danger').trigger('click')
    expect(wrapper.props('removeMember')).toHaveBeenCalledWith('member-id')
  })

  it('does not render manager controls for an ordinary member', async () => {
    const wrapper = mountPanel('member-id')
    await wrapper.get('.conversation-details-tabs button:last-child').trigger('click')
    expect(wrapper.find('.group-title-form').exists()).toBe(false)
    expect(wrapper.find('.group-add-member').exists()).toBe(false)
    expect(wrapper.find('.group-member-actions').exists()).toBe(false)
    expect(wrapper.get('.group-leave-button').text()).toContain('Покинуть')
  })

  it('shows direct-chat identity and opens the source message from the file library', async () => {
    const openMessage = vi.fn().mockResolvedValue(undefined)
    const loadAttachment = vi.fn().mockResolvedValue(new Blob(['file'], { type: 'application/pdf' }))
    const createObjectURL = vi.fn().mockReturnValue('blob:conversation-file')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const wrapper = mount(ConversationDetailsPanel, {
      props: {
        conversation: {
          ...conversation,
          conversationType: 'direct' as const,
          title: null,
          members: conversation.members.map(member => ({ ...member, role: 'member' as const })),
        },
        directory: [],
        actorUserId: 'owner-id',
        online: true,
        busy: false,
        notice: null,
        mediaItems: [{
          messageId: 'message-file',
          sequence: 7,
          senderUserId: 'member-id',
          createdAt: '2026-08-23T12:00:00Z',
          expiresAt: '2026-09-22T12:00:00Z',
          attachment: {
            attachmentId: 'file-id',
            kind: 'file',
            name: 'brief.pdf',
            contentType: 'application/pdf',
            byteSize: 1_024,
          },
        }],
        mediaLoading: false,
        mediaTruncated: false,
        reloadMedia: vi.fn().mockResolvedValue(undefined),
        loadAttachment,
        openMessage,
        renameGroup: vi.fn().mockResolvedValue(false),
        addMember: vi.fn().mockResolvedValue(false),
        removeMember: vi.fn().mockResolvedValue(false),
        leaveGroup: vi.fn().mockResolvedValue(false),
      },
    })

    expect(wrapper.get('.conversation-details-hero').text()).toContain('Member')
    expect(wrapper.get('.conversation-details-hero').text()).toContain('@member')
    expect(wrapper.get('.conversation-details-hero').text()).toContain('В сети')
    await wrapper.get('.conversation-details-tabs button:nth-child(2)').trigger('click')
    await wrapper.get('.conversation-media-meta button').trigger('click')

    expect(openMessage).toHaveBeenCalledWith('message-file')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('.conversation-media-meta button:last-child').trigger('click')
    expect(loadAttachment).toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({ attachmentId: 'file-id' }),
      '2026-09-22T12:00:00Z',
    )
    expect(createObjectURL).toHaveBeenCalledOnce()
  })
})
