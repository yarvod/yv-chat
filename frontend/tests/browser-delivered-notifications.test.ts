import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserPushAdapter } from '../app/infrastructure/browser/browser-push'

const conversationId = 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e'
const messageId = '7befbd28-1b77-48ee-8b6c-6f279fc1b92e'

function notification(tag: string, data: unknown) {
  return { tag, data, close: vi.fn() }
}

afterEach(() => vi.unstubAllGlobals())

describe('browser delivered notifications', () => {
  it('closes only matching message notifications, preserving calls, malformed items and newly arrived messages', async () => {
    const first = notification('yv-message-1', { conversationId, messageId })
    const second = notification('yv-message-2', { conversationId, messageId })
    const unread = notification('yv-message-3', {
      conversationId, messageId: '60cf6877-9dd1-454e-86ac-f42303c7775a',
    })
    const call = notification('yv-call-1', { conversationId, messageId: null })
    const malformed = notification('yv-message-bad', { conversationId: '/evil', messageId })
    const getNotifications = vi.fn().mockResolvedValue([first, second, call, malformed])
    vi.stubGlobal('navigator', { serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({ getNotifications }),
    } })
    vi.stubGlobal('Notification', vi.fn())
    vi.stubGlobal('PushManager', vi.fn())
    const adapter = new BrowserPushAdapter()
    const delivered = await adapter.listMessages()
    expect(delivered).toEqual([
      { id: first.tag, conversationId, messageId },
      { id: second.tag, conversationId, messageId },
    ])
    getNotifications.mockResolvedValue([first, second, unread, call, malformed])
    await adapter.dismissMessages(delivered)
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
    expect(unread.close).not.toHaveBeenCalled()
    expect(call.close).not.toHaveBeenCalled()
    expect(malformed.close).not.toHaveBeenCalled()
  })

  it('settles with no registration and never requests permission', async () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { requestPermission })
    vi.stubGlobal('PushManager', vi.fn())
    vi.stubGlobal('navigator', { serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(undefined),
    } })
    expect(await new BrowserPushAdapter().listMessages()).toEqual([])
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
