import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MessageText from '../app/components/chat/MessageText.vue'
import { buildMessageTextSegments } from '../app/presentation/chat/message-text-segments'

const members = [{
  userId: 'bob-id',
  username: 'bob',
  displayName: 'Bob',
  role: 'member' as const,
  joinedAt: '2026-08-12T12:00:00Z',
  leftAt: null,
}]

describe('message links', () => {
  it('renders only http/https and www links for the device browser', () => {
    const wrapper = mount(MessageText, {
      props: {
        body: 'Документация https://example.com/a?q=1, зеркало www.example.org/path.',
      },
    })
    const links = wrapper.findAll('a')

    expect(links).toHaveLength(2)
    expect(links[0]?.attributes()).toMatchObject({
      href: 'https://example.com/a?q=1',
      target: '_blank',
      rel: 'noopener noreferrer external',
    })
    expect(links[1]?.attributes('href')).toBe('https://www.example.org/path')
    expect(wrapper.text()).toContain('path.')
  })

  it('keeps unsafe schemes and HTML-looking message content inert text', () => {
    const wrapper = mount(MessageText, {
      props: {
        body: '<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,bad',
      },
    })

    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })

  it('preserves intended mentions outside URLs and balanced URL punctuation', () => {
    expect(buildMessageTextSegments(
      'Для @bob: https://example.com/a_(b).',
      members,
      ['bob-id'],
      'bob-id',
    )).toEqual([
      { kind: 'text', text: 'Для ' },
      { kind: 'mention', text: '@bob', own: true },
      { kind: 'text', text: ': ' },
      { kind: 'link', text: 'https://example.com/a_(b)', href: 'https://example.com/a_(b)' },
      { kind: 'text', text: '.' },
    ])
  })
})
