import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ExternalLinkMenu from '../app/components/ui/ExternalLinkMenu.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function setup() {
  const links = {
    needsActionMenu: vi.fn(() => true),
    externalUrl: vi.fn((url: string) => url),
    canShare: vi.fn(() => true),
    share: vi.fn().mockResolvedValue(undefined),
  }
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
  const wrapper = mount(ExternalLinkMenu, { props: { links, clipboard }, attachTo: document.body })
  wrappers.push(wrapper)
  const anchor = document.createElement('a')
  anchor.href = 'https://kuula.co/post/test?q=1#view'
  anchor.className = 'message-link'
  anchor.textContent = anchor.href
  document.body.append(anchor)
  const click = (options: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options })
    anchor.dispatchEvent(event)
    return event
  }
  return { wrapper, links, clipboard, anchor, click }
}

describe('Android PWA link menu', () => {
  it('prevents immediate browser navigation and copies the exact URL while keeping canonical href', async () => {
    const { wrapper, clipboard, anchor, click } = setup()
    expect(click().defaultPrevented).toBe(true)
    await flushPromises()
    expect(wrapper.get('dialog').attributes()).toHaveProperty('open')
    expect(wrapper.text()).toContain('Внешняя ссылка')
    await wrapper.get('button.primary-button').trigger('click')
    expect(clipboard.writeText).toHaveBeenCalledWith(anchor.href)
    expect(wrapper.get('[role="status"]').text()).toBe('Ссылка скопирована')
    expect(wrapper.get('a').attributes()).toMatchObject({
      href: anchor.href, target: '_blank', rel: 'noopener noreferrer external',
    })
    expect(anchor.href).toBe('https://kuula.co/post/test?q=1#view')
  })

  it('leaves modified clicks and other platforms untouched', async () => {
    const { wrapper, links, click } = setup()
    expect(click({ ctrlKey: true }).defaultPrevented).toBe(false)
    links.needsActionMenu.mockReturnValue(false)
    expect(click().defaultPrevented).toBe(false)
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('closes on cancel, restores focus, and removes its listener when unmounted', async () => {
    const { wrapper, anchor, click } = setup()
    click()
    await flushPromises()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.find('section').exists()).toBe(false)
    expect(document.activeElement).toBe(anchor)
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(click().defaultPrevented).toBe(false)
  })

  it('shares in the gesture and treats cancellation as harmless; hides unsupported sharing', async () => {
    const { wrapper, links, anchor, click } = setup()
    links.share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    click()
    await flushPromises()
    const share = wrapper.findAll('button').find(button => button.text() === 'Поделиться…')!
    await share.trigger('click')
    await flushPromises()
    expect(links.share).toHaveBeenCalledWith(anchor.href)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('section').exists()).toBe(true)
    await share.trigger('click')
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
    links.canShare.mockReturnValue(false)
    click()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Поделиться…')
  })

  it('keeps the URL selectable and explains clipboard failure without leaving the app', async () => {
    const { wrapper, clipboard, click } = setup()
    clipboard.writeText.mockRejectedValueOnce(new Error('permission denied'))
    click()
    await flushPromises()
    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('скопируйте вручную')
    expect(wrapper.get('dialog').attributes()).toHaveProperty('open')
  })
})
