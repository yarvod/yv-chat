import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import GroupDetailsPanel from '../app/components/chat/GroupDetailsPanel.vue'

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
  return mount(GroupDetailsPanel, {
    props: {
      conversation,
      directory: [
        { userId: 'owner-id', username: 'owner', displayName: 'Owner' },
        { userId: 'member-id', username: 'member', displayName: 'Member' },
        { userId: 'new-id', username: 'new', displayName: 'New person' },
      ],
      actorUserId,
      busy: false,
      notice: null,
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

  it('does not render manager controls for an ordinary member', () => {
    const wrapper = mountPanel('member-id')
    expect(wrapper.find('.group-title-form').exists()).toBe(false)
    expect(wrapper.find('.group-add-member').exists()).toBe(false)
    expect(wrapper.find('.group-member-actions').exists()).toBe(false)
    expect(wrapper.get('.group-leave-button').text()).toContain('Покинуть')
  })
})
